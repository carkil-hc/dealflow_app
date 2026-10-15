// Live "ask anything over the whole graph" endpoint. An agentic loop: Claude is
// given a READ-ONLY Gremlin tool, writes its own traversals against the Cosmos
// knowledge graph (any slice or cross-slice), reads real rows back, and answers
// from them. Self-contained (own Gremlin client) so the app build stays separate
// from the graph/ subsystem. Needs GRAPH_KEY + ANTHROPIC_API_KEY in the environment.
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import gremlin from 'gremlin';

const GREMLIN_ENDPOINT = 'hc-dealflow-graph.gremlin.cosmos.azure.com';
const GREMLIN_USER = '/dbs/intel/colls/graph';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openGraph(): any {
  const key = process.env.GRAPH_KEY;
  if (!key) throw new Error('GRAPH_KEY not set');
  const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(GREMLIN_USER, key);
  return new gremlin.driver.Client(`wss://${GREMLIN_ENDPOINT}:443/gremlin`, {
    authenticator, traversalsource: 'g', rejectUnauthorized: true,
    mimeType: 'application/vnd.gremlin-v2.0+json', // Cosmos requires GraphSON 2.0
  });
}

const MUTATING = /\b(addV|addE|drop|sideEffect|property\s*\(|aggregate|store)\b/i;
function validateReadOnly(q: string): void {
  const s = q.trim();
  if (!/^g\s*\.\s*(V|E)\s*\(/.test(s)) throw new Error('query must start with g.V(...) or g.E(...)');
  if (MUTATING.test(s)) throw new Error('read-only queries only');
  if (s.length > 2000) throw new Error('query too long');
}

const SCHEMA = `VERTICES (label{key props}): DealflowCompany{name,modality,seedDisease,seedTarget,seedMechanism,maxStage} Company{name} Program{name,modality,isCellTherapy,developmentStage,status,approved,sponsorClass,mechanismOfAction} Target{symbol} Disease{name} Modality{name} ClinicalTrial{title,phase,status,sponsor} Financing{roundType,amountRaised,currency,date} Deal{dealType,value,date,counterparty} Investor{name} Person{name,orcid,country,leadWorks,recentWorks} Institution{name} Publication{title,doi,year,venue,findingsSummary}
EDGES: (DealflowCompany)-develops_for->(Disease) (DealflowCompany)-competes_with->(Company) (Company)-develops->(Program) (Program)-has_target->(Target) (Program)-treats->(Disease) (Program)-has_modality->(Modality) (Program)-tested_in->(ClinicalTrial) (Company)-sponsors->(ClinicalTrial) (Company)-raised->(Financing) (Investor)-invested_in->(Financing) (Company)-party_to->(Deal) (Deal)-deal_counterparty->(Company) (Person)-authored->(Publication) (Publication)-about->(Disease) (Publication)-about_target->(Target) (Person)-affiliated_with->(Institution) (Person)-researches->(Disease)
Every vertex has id + pk. pk = the disease slice (a MONDO/EFO id, e.g. MONDO_0005180 = Parkinson's, MONDO_0002009 = major depressive disorder). Provenance on every element: source, url, trustTier ('structured'|'inferred').`;

const SYSTEM = `You are a biopharma competitive-intelligence analyst querying HealthCap's knowledge graph (Azure Cosmos DB, Gremlin). Answer by calling the graph_query tool with READ-ONLY Gremlin, then reason over the rows.

GRAPH SCHEMA:
${SCHEMA}

RULES:
- Use graph_query to get real data before answering; never invent nodes or numbers.
- Always bound traversals with .limit(N) (<=200) and prefer project(...).by(...) for named fields.
- One disease: filter .has('pk','<slice id>'); CROSS-SLICE (all diseases): omit the pk filter.
- Cosmos Gremlin: no lambdas; use valueMap/project/group/groupCount/where/dedup/count. Keep projections simple; if one errors, simplify it.
- Be efficient: 2–4 well-aimed queries are usually enough, then STOP and answer.
- Cite the specific companies/programs/deals the data shows. If the graph lacks it, say so — do not speculate.`;

export interface AskResult { answer: string; trace: { gremlin?: string; rows?: number; error?: string }[]; }

export async function askGraph(question: string, opts: { maxSteps?: number } = {}): Promise<AskResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey: key });
  const g = openGraph();
  const trace: AskResult['trace'] = [];
  const tools: Anthropic.Tool[] = [{
    name: 'graph_query',
    description: 'Run ONE read-only Gremlin traversal and get rows back as JSON. Must start with g.V(...) or g.E(...), be bounded with .limit(), no writes.',
    input_schema: { type: 'object', properties: { gremlin: { type: 'string' } }, required: ['gremlin'] },
  }];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  try {
    for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
      const resp = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1800, system: SYSTEM, tools, messages });
      messages.push({ role: 'assistant', content: resp.content });
      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!toolUses.length) {
        return { answer: resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join(''), trace };
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const q = (tu.input as { gremlin?: string }).gremlin ?? '';
        let content: string;
        try {
          validateReadOnly(q);
          const rs = await g.submit(q, {});
          const rows = rs.toArray();
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
    messages.push({ role: 'user', content: 'Give your best final answer now from the data already returned; do not request more queries.' });
    const fin = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1800, system: SYSTEM, messages });
    return { answer: fin.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('') || '(no answer)', trace };
  } finally {
    await g.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(g: any, q: string, b: Record<string, unknown> = {}): Promise<any[]> {
  const rs = await g.submit(q, b);
  return rs.toArray();
}

// Structured slice data for a dealflow company, for inline display in the app.
export async function getIntelligence(companyId: string): Promise<Record<string, unknown>> {
  const dfId = 'dealflow:' + companyId;
  const g = openGraph();
  try {
    const df = await run(g, "g.V(dfId).project('name','pk','modality','target','mechanism','maxStage').by(values('name')).by(values('seedDisease')).by(__.coalesce(__.values('modality'),__.constant('-'))).by(__.coalesce(__.values('seedTarget'),__.constant('-'))).by(__.coalesce(__.values('seedMechanism'),__.constant('-'))).by(__.coalesce(__.values('maxStage'),__.constant('-')))", { dfId });
    if (!df.length) return { collected: false };
    const pk = df[0].pk as string;
    const q = (s: string) => run(g, s, { pk });
    const [programs, deals, financings, kols, publications] = await Promise.all([
      q("g.V().hasLabel('Program').has('pk',pk).project('company','program','stage','status','modality','approved','src','moa').by(__.in('develops').values('name').fold()).by('name').by('developmentStage').by('status').by(__.coalesce(__.values('modality'),__.constant('-'))).by(__.coalesce(__.values('approved'),__.constant(false))).by(__.coalesce(__.values('source'),__.constant('-'))).by(__.coalesce(__.values('mechanismOfAction'),__.constant('-')))"),
      q("g.V().hasLabel('Deal').has('pk',pk).project('company','type','value','date','counterparty','src').by(__.in('party_to').values('name').fold()).by('dealType').by(__.coalesce(__.values('value'),__.constant('-'))).by(__.coalesce(__.values('date'),__.constant('-'))).by(__.coalesce(__.values('counterparty'),__.constant('-'))).by(__.coalesce(__.values('source'),__.constant('-')))"),
      q("g.V().hasLabel('Financing').has('pk',pk).project('company','round','amount','date').by(__.in('raised').values('name').fold()).by('roundType').by(__.coalesce(__.values('amountRaised'),__.constant(0))).by(__.coalesce(__.values('date'),__.constant('-')))"),
      q("g.V().hasLabel('Person').has('pk',pk).project('name','country','lead','total','inst').by('name').by(__.coalesce(__.values('country'),__.constant('-'))).by(__.coalesce(__.values('leadWorks'),__.constant(0))).by(__.coalesce(__.values('recentWorks'),__.constant(0))).by(__.coalesce(__.out('affiliated_with').values('name'),__.constant('-')).fold())"),
      q("g.V().hasLabel('Publication').has('pk',pk).project('title','venue','year','findings','doi','kol').by('title').by(__.coalesce(__.values('venue'),__.constant('-'))).by(__.coalesce(__.values('year'),__.constant(0))).by(__.coalesce(__.values('findingsSummary'),__.constant('-'))).by(__.coalesce(__.values('doi'),__.constant('-'))).by(__.in('authored').values('name').fold())"),
    ]);
    return { collected: true, seed: df[0], programs, deals, financings, kols, publications };
  } finally {
    await g.close();
  }
}

export const graphAskRouter = Router();

// GET /api/companies/:id/intelligence — structured slice data for the Intelligence tab.
graphAskRouter.get('/api/companies/:id/intelligence', async (req, res) => {
  try {
    res.json(await getIntelligence(req.params.id));
  } catch (err) {
    console.error('[graph/intelligence]', err);
    res.status(500).json({ error: 'intelligence fetch failed', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/graph/ask { question } → { answer, trace }
graphAskRouter.post('/api/graph/ask', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (question.length > 1000) return res.status(400).json({ error: 'question too long' });
  try {
    const result = await askGraph(question);
    res.json(result);
  } catch (err) {
    console.error('[graph/ask]', err);
    res.status(500).json({ error: 'ask failed', detail: err instanceof Error ? err.message : String(err) });
  }
});
