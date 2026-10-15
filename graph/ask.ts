// Live "ask anything over the whole graph": an agentic loop where Claude is given
// a READ-ONLY Gremlin tool, writes its own traversals against Cosmos (any slice or
// cross-slice), reads the real rows back, and answers from them. This is the core
// behind the server /api/graph/ask endpoint — no embedded snapshot, always live.
import Anthropic from '@anthropic-ai/sdk';
import { openGraph, GraphClient } from './upsert.js';
import { VERTICES, EDGES } from './schema.js';

// Reject anything that could mutate the graph or run unbounded.
const MUTATING = /\b(addV|addE|drop|sideEffect|property\s*\(|aggregate|store)\b/i;
function validateReadOnly(q: string): void {
  const s = q.trim();
  if (!/^g\s*\.\s*(V|E)\s*\(/.test(s)) throw new Error('query must start with g.V(...) or g.E(...)');
  if (MUTATING.test(s)) throw new Error('read-only queries only (no addV/addE/drop/property/...)');
  if (s.length > 2000) throw new Error('query too long');
}

function schemaDoc(): string {
  const v = Object.entries(VERTICES).map(([l, d]) => `${l}{${[...d.required, ...d.optional].join(',')}}`).join('  ');
  const e = EDGES.map(x => `(${x.from})-${x.label}->(${x.to})`).join('  ');
  return `VERTICES (label{props}): ${v}\nEDGES: ${e}\nEvery vertex has id + pk. pk = the disease slice (a MONDO/EFO id, e.g. MONDO_0005180 = Parkinson's, MONDO_0002009 = major depressive disorder). A DealflowCompany id is 'dealflow:<id>'. Company ids are 'company:<slug>'. Provenance props on every element: source, url, trustTier ('structured'|'inferred'). Program has developmentStage (PHASE1..PHASE4/NA), status (active|discontinued), modality, isCellTherapy, approved, sponsorClass. Deal has dealType, value, date, counterparty. Financing has roundType, amountRaised.`;
}

const SYSTEM = `You are a biopharma competitive-intelligence analyst querying HealthCap's knowledge graph (Azure Cosmos DB, Gremlin). Answer the user's question by calling the graph_query tool with READ-ONLY Gremlin traversals, then reason over the rows.

${''}GRAPH SCHEMA:
${schemaDoc()}

RULES:
- Use graph_query to get real data before answering; never invent nodes or numbers.
- Always bound traversals with .limit(N) (<=200) and prefer project(...).by(...) to return named fields.
- To stay within one disease, filter .has('pk', '<slice id>'); to go CROSS-SLICE (all diseases), omit the pk filter.
- Cosmos Gremlin: no lambdas; use valueMap/project/group/groupCount/where/dedup/count.
- If a query errors, read the error and try a corrected one (a few tries max).
- Be efficient: 2–4 well-aimed queries are usually enough. Once you have the data, STOP querying and answer.
- Answer concisely and cite the specific companies/programs/deals the data shows. If the graph lacks the data, say so plainly — do not speculate.`;

export interface AskResult { answer: string; trace: { gremlin?: string; rows?: number; error?: string }[]; }

export async function askGraph(question: string, opts: { maxSteps?: number; model?: string } = {}): Promise<AskResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey: key });
  const g: GraphClient = openGraph();
  const trace: AskResult['trace'] = [];
  const tools: Anthropic.Tool[] = [{
    name: 'graph_query',
    description: 'Run ONE read-only Gremlin traversal against the knowledge graph and get rows back as JSON. Must start with g.V(...) or g.E(...), be bounded with .limit(), and contain no writes.',
    input_schema: { type: 'object', properties: { gremlin: { type: 'string', description: 'A read-only Gremlin traversal, e.g. g.V().hasLabel(\'Deal\').limit(20).valueMap(true)' } }, required: ['gremlin'] },
  }];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  try {
    for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
      const resp = await client.messages.create({ model: opts.model ?? 'claude-sonnet-4-5', max_tokens: 1800, system: SYSTEM, tools, messages });
      messages.push({ role: 'assistant', content: resp.content });
      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!toolUses.length) {
        const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
        return { answer: text, trace };
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const q = (tu.input as { gremlin?: string }).gremlin ?? '';
        let content: string;
        try {
          validateReadOnly(q);
          const rows = await g.run(q);
          content = JSON.stringify(rows).slice(0, 6000);
          trace.push({ gremlin: q, rows: rows.length });
        } catch (e) {
          content = 'ERROR: ' + (e instanceof Error ? e.message : String(e));
          trace.push({ gremlin: q, error: content });
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content });
      }
      messages.push({ role: 'user', content: results });
    }
    // Budget spent: force a final answer from what was gathered (no more tools).
    messages.push({ role: 'user', content: 'Give your best final answer now, using only the data already returned by your queries. Do not request more queries.' });
    const fin = await client.messages.create({ model: opts.model ?? 'claude-sonnet-4-5', max_tokens: 1800, system: SYSTEM, messages });
    const text = fin.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
    return { answer: text || '(no answer produced)', trace };
  } finally {
    await g.close();
  }
}
