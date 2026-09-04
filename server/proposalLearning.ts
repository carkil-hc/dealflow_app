import sql from 'mssql';
import { createRequire } from 'node:module';
import { getPool } from './db.js';
import { askClaudeText } from './anthropic.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const { parseOffice } = require('officeparser') as { parseOffice: (input: Buffer, cfg?: any) => Promise<any> };

// Extract plain text from a .docx buffer (same method for the generated draft
// and the finalized version, so the comparison is apples-to-apples).
export async function extractDocxText(bytes: Buffer): Promise<string> {
  const parsed = await parseOffice(bytes, { fileType: 'docx' });
  return String(parsed?.toText?.() ?? parsed ?? '').trim();
}

// Extract text from an uploaded proposal (PDF, DOCX, or PPTX), chosen by extension.
export async function extractText(name: string, base64: string): Promise<string> {
  const lower = name.toLowerCase();
  const fileType = lower.endsWith('.pdf') ? 'pdf'
    : lower.endsWith('.pptx') ? 'pptx'
    : 'docx';
  const parsed = await parseOffice(Buffer.from(base64, 'base64'), { fileType });
  return String(parsed?.toText?.() ?? parsed ?? '').trim();
}

// Tables self-create on first use — no manual migration needed at deploy.
let tablesReady = false;
async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  const pool = await getPool();
  await pool.request().batch(`
    IF OBJECT_ID('proposal_drafts','U') IS NULL
      CREATE TABLE proposal_drafts (
        company_id     NVARCHAR(50)  NOT NULL,
        version        INT           NOT NULL,
        generated_text NVARCHAR(MAX) NOT NULL,
        created_at     NVARCHAR(30)  NOT NULL,
        CONSTRAINT PK_proposal_drafts PRIMARY KEY (company_id, version)
      );
    IF OBJECT_ID('proposal_guide','U') IS NULL
      CREATE TABLE proposal_guide (
        id         INT           NOT NULL PRIMARY KEY,
        guide      NVARCHAR(MAX) NOT NULL,
        updated_at NVARCHAR(30)  NOT NULL
      );
  `);
  tablesReady = true;
}

// Persist the AI-generated draft text so it can later be compared to the
// human-finalized version that gets sent for signing.
export async function saveDraft(companyId: string, version: number, generatedText: string): Promise<void> {
  await ensureTables();
  const pool = await getPool();
  await pool.request()
    .input('c', sql.NVarChar(50), companyId)
    .input('v', sql.Int, version)
    .input('t', sql.NVarChar(sql.MAX), generatedText)
    .input('at', sql.NVarChar(30), new Date().toISOString())
    .query(`MERGE proposal_drafts AS t
      USING (SELECT @c AS company_id, @v AS version) AS s
      ON t.company_id = s.company_id AND t.version = s.version
      WHEN MATCHED THEN UPDATE SET generated_text = @t, created_at = @at
      WHEN NOT MATCHED THEN INSERT (company_id, version, generated_text, created_at)
        VALUES (@c, @v, @t, @at);`);
}

export async function getDraft(companyId: string, version: number): Promise<string | null> {
  await ensureTables();
  const pool = await getPool();
  const r = await pool.request()
    .input('c', sql.NVarChar(50), companyId)
    .input('v', sql.Int, version)
    .query('SELECT generated_text FROM proposal_drafts WHERE company_id = @c AND version = @v');
  return r.recordset[0]?.generated_text ?? null;
}

// The evolving drafting guide, injected into the generation prompt. Empty until
// the first edit has been learned from.
export async function getDraftingGuide(): Promise<string> {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request().query('SELECT guide FROM proposal_guide WHERE id = 1');
    return r.recordset[0]?.guide ?? '';
  } catch {
    return ''; // never block generation on the guide being unavailable
  }
}

async function saveGuide(guide: string): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('g', sql.NVarChar(sql.MAX), guide)
    .input('at', sql.NVarChar(30), new Date().toISOString())
    .query(`MERGE proposal_guide AS t
      USING (SELECT 1 AS id) AS s ON t.id = s.id
      WHEN MATCHED THEN UPDATE SET guide = @g, updated_at = @at
      WHEN NOT MATCHED THEN INSERT (id, guide, updated_at) VALUES (1, @g, @at);`);
}

// Compare the AI draft to the human-finalized version and fold any general,
// reusable lessons into the drafting guide. Best-effort; callers ignore errors.
export async function learnFromEdit(opts: { companyName: string; generatedText: string; finalText: string }): Promise<void> {
  const current = await getDraftingGuide();
  const prompt = `You maintain a concise DRAFTING GUIDE that teaches an AI to draft HealthCap investment proposals so they need fewer human edits before being sent for signing.

Below are (A) the AI-generated draft and (B) the human-finalized version actually sent for signing, for the company "${opts.companyName}". Compare them and identify GENERAL, reusable drafting lessons — patterns in what the reviewer changed: tone, structure, level of detail, wording, sections added/removed/reordered, hedging, formatting, house conventions. IGNORE anything company-specific (facts, figures, names) — capture only lessons that would help draft the NEXT, unrelated proposal.

Merge any new consistent lessons into the existing guide. Keep it concise (max ~1000 words), deduplicated, and grouped by theme. If the two versions are essentially the same, or the differences are purely company-specific, return the current guide UNCHANGED.

=== CURRENT GUIDE ===
${current || '(empty — you are starting the guide)'}

=== (A) AI-GENERATED DRAFT ===
${opts.generatedText.slice(0, 28000)}

=== (B) HUMAN-FINALIZED VERSION (sent for signing) ===
${opts.finalText.slice(0, 28000)}

Return ONLY the updated guide as Markdown, with no preamble or commentary.`;
  const updated = await askClaudeText({ content: prompt, model: 'claude-sonnet-4-5', maxTokens: 4000 });
  if (updated && updated.length > 20) await saveGuide(updated);
}

// Seed / augment the guide from finalized exemplar proposals (no AI draft to
// diff against — study them as gold-standard house style).
export async function seedGuideFromExamples(examples: { name: string; text: string }[]): Promise<void> {
  const current = await getDraftingGuide();
  const joined = examples
    .map((e, i) => `=== EXAMPLE ${i + 1}: ${e.name} ===\n${e.text.slice(0, 20000)}`)
    .join('\n\n');
  const prompt = `You maintain a concise DRAFTING GUIDE that teaches an AI to draft HealthCap investment proposals in the correct house style, so they need minimal human editing.

Below are ${examples.length} finalized, human-written HealthCap investment proposal(s), considered gold-standard. Study them and extract GENERAL, reusable drafting guidance: structure and section order, tone and voice, typical length, level of detail, formatting and house conventions, what each section should and should not contain, and recurring phrasing patterns. IGNORE company-specific facts, figures and names — capture only what transfers to a NEW, unrelated proposal.

Merge your findings into the existing guide. Keep it concise (max ~1200 words), deduplicated, and grouped by theme.

=== CURRENT GUIDE ===
${current || '(empty — you are starting the guide)'}

${joined}

Return ONLY the updated guide as Markdown, with no preamble or commentary.`;
  const updated = await askClaudeText({ content: prompt, model: 'claude-sonnet-4-5', maxTokens: 4000 });
  if (updated && updated.length > 20) await saveGuide(updated);
}

// Clear the guide entirely (start over).
export async function resetGuide(): Promise<void> {
  await ensureTables();
  const pool = await getPool();
  await pool.request().query('DELETE FROM proposal_guide WHERE id = 1');
}
