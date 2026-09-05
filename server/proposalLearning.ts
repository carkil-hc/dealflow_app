import sql from 'mssql';
import { createRequire } from 'node:module';
import { getPool } from './db.js';
import { askClaudeText } from './anthropic.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const { parseOffice } = require('officeparser') as { parseOffice: (input: Buffer, cfg?: any) => Promise<any> };

// The document types that have their own drafting guide and draft history.
export type DocType = 'proposal' | 'recommendation';
const DOC_LABEL: Record<DocType, string> = {
  proposal: 'investment proposals',
  recommendation: 'investment recommendations',
};

// Extract plain text from a .docx buffer (same method for the generated draft
// and the finalized version, so the comparison is apples-to-apples).
export async function extractDocxText(bytes: Buffer): Promise<string> {
  const parsed = await parseOffice(bytes, { fileType: 'docx' });
  return String(parsed?.toText?.() ?? parsed ?? '').trim();
}

// Extract text from an uploaded document (PDF, DOCX, or PPTX), chosen by extension.
export async function extractText(name: string, base64: string): Promise<string> {
  const lower = name.toLowerCase();
  const fileType = lower.endsWith('.pdf') ? 'pdf'
    : lower.endsWith('.pptx') ? 'pptx'
    : 'docx';
  const parsed = await parseOffice(Buffer.from(base64, 'base64'), { fileType });
  return String(parsed?.toText?.() ?? parsed ?? '').trim();
}

// Tables self-create on first use (created out-of-band for existing DBs; the
// guards mean the app's DML-only identity never needs DDL when they exist).
let tablesReady = false;
async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  const pool = await getPool();
  await pool.request().batch(`
    IF OBJECT_ID('drafting_guides','U') IS NULL
      CREATE TABLE drafting_guides (
        doc_type   NVARCHAR(30)  NOT NULL PRIMARY KEY,
        guide      NVARCHAR(MAX) NOT NULL,
        updated_at NVARCHAR(30)  NOT NULL
      );
    IF OBJECT_ID('generation_drafts','U') IS NULL
      CREATE TABLE generation_drafts (
        company_id     NVARCHAR(50)  NOT NULL,
        version        INT           NOT NULL,
        doc_type       NVARCHAR(30)  NOT NULL,
        generated_text NVARCHAR(MAX) NOT NULL,
        created_at     NVARCHAR(30)  NOT NULL,
        CONSTRAINT PK_generation_drafts PRIMARY KEY (company_id, version, doc_type)
      );
  `);
  tablesReady = true;
}

// Persist the AI-generated draft text so it can later be compared to the
// human-finalized version that gets sent for signing.
export async function saveDraft(companyId: string, version: number, docType: DocType, generatedText: string): Promise<void> {
  await ensureTables();
  const pool = await getPool();
  await pool.request()
    .input('c', sql.NVarChar(50), companyId)
    .input('v', sql.Int, version)
    .input('dt', sql.NVarChar(30), docType)
    .input('t', sql.NVarChar(sql.MAX), generatedText)
    .input('at', sql.NVarChar(30), new Date().toISOString())
    .query(`MERGE generation_drafts AS t
      USING (SELECT @c AS company_id, @v AS version, @dt AS doc_type) AS s
      ON t.company_id = s.company_id AND t.version = s.version AND t.doc_type = s.doc_type
      WHEN MATCHED THEN UPDATE SET generated_text = @t, created_at = @at
      WHEN NOT MATCHED THEN INSERT (company_id, version, doc_type, generated_text, created_at)
        VALUES (@c, @v, @dt, @t, @at);`);
}

export async function getDraft(companyId: string, version: number, docType: DocType): Promise<string | null> {
  await ensureTables();
  const pool = await getPool();
  const r = await pool.request()
    .input('c', sql.NVarChar(50), companyId)
    .input('v', sql.Int, version)
    .input('dt', sql.NVarChar(30), docType)
    .query('SELECT generated_text FROM generation_drafts WHERE company_id = @c AND version = @v AND doc_type = @dt');
  return r.recordset[0]?.generated_text ?? null;
}

// The evolving drafting guide for a doc type, injected into its generation prompt.
export async function getDraftingGuide(docType: DocType): Promise<string> {
  try {
    await ensureTables();
    const pool = await getPool();
    const r = await pool.request()
      .input('dt', sql.NVarChar(30), docType)
      .query('SELECT guide FROM drafting_guides WHERE doc_type = @dt');
    return r.recordset[0]?.guide ?? '';
  } catch {
    return ''; // never block generation on the guide being unavailable
  }
}

async function saveGuide(docType: DocType, guide: string): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('dt', sql.NVarChar(30), docType)
    .input('g', sql.NVarChar(sql.MAX), guide)
    .input('at', sql.NVarChar(30), new Date().toISOString())
    .query(`MERGE drafting_guides AS t
      USING (SELECT @dt AS doc_type) AS s ON t.doc_type = s.doc_type
      WHEN MATCHED THEN UPDATE SET guide = @g, updated_at = @at
      WHEN NOT MATCHED THEN INSERT (doc_type, guide, updated_at) VALUES (@dt, @g, @at);`);
}

// Compare the AI draft to the human-finalized version and fold any general,
// reusable lessons into the drafting guide. Best-effort; callers ignore errors.
export async function learnFromEdit(docType: DocType, opts: { companyName: string; generatedText: string; finalText: string }): Promise<void> {
  const current = await getDraftingGuide(docType);
  const label = DOC_LABEL[docType];
  const prompt = `You maintain a concise DRAFTING GUIDE that teaches an AI to draft HealthCap ${label} so they need fewer human edits before being sent for signing.

Below are (A) the AI-generated draft and (B) the human-finalized version actually sent for signing, for the company "${opts.companyName}". Compare them and identify GENERAL, reusable drafting lessons — patterns in what the reviewer changed: tone, structure, level of detail, wording, sections added/removed/reordered, hedging, formatting, house conventions. IGNORE anything company-specific (facts, figures, names) — capture only lessons that would help draft the NEXT, unrelated ${docType}.

Merge any new consistent lessons into the existing guide. Keep it concise (max ~1000 words), deduplicated, and grouped by theme. If the two versions are essentially the same, or the differences are purely company-specific, return the current guide UNCHANGED.

=== CURRENT GUIDE ===
${current || '(empty — you are starting the guide)'}

=== (A) AI-GENERATED DRAFT ===
${opts.generatedText.slice(0, 28000)}

=== (B) HUMAN-FINALIZED VERSION (sent for signing) ===
${opts.finalText.slice(0, 28000)}

Return ONLY the updated guide as Markdown, with no preamble or commentary.`;
  const updated = await askClaudeText({ content: prompt, model: 'claude-sonnet-4-5', maxTokens: 4000 });
  if (updated && updated.length > 20) await saveGuide(docType, updated);
}

// Seed / augment a guide from finalized exemplar documents (no AI draft to
// diff against — study them as gold-standard house style).
export async function seedGuideFromExamples(docType: DocType, examples: { name: string; text: string }[]): Promise<void> {
  const current = await getDraftingGuide(docType);
  const label = DOC_LABEL[docType];
  const joined = examples
    .map((e, i) => `=== EXAMPLE ${i + 1}: ${e.name} ===\n${e.text.slice(0, 20000)}`)
    .join('\n\n');
  const prompt = `You maintain a concise DRAFTING GUIDE that teaches an AI to draft HealthCap ${label} in the correct house style, so they need minimal human editing.

Below are ${examples.length} finalized, human-written HealthCap ${label}, considered gold-standard. Study them and extract GENERAL, reusable drafting guidance: structure and section order, tone and voice, typical length, level of detail, formatting and house conventions, what each section should and should not contain, and recurring phrasing patterns. IGNORE company-specific facts, figures and names — capture only what transfers to a NEW, unrelated document.

Merge your findings into the existing guide. Keep it concise (max ~1200 words), deduplicated, and grouped by theme.

=== CURRENT GUIDE ===
${current || '(empty — you are starting the guide)'}

${joined}

Return ONLY the updated guide as Markdown, with no preamble or commentary.`;
  const updated = await askClaudeText({ content: prompt, model: 'claude-sonnet-4-5', maxTokens: 4000 });
  if (updated && updated.length > 20) await saveGuide(docType, updated);
}

// Clear a guide entirely (start over).
export async function resetGuide(docType: DocType): Promise<void> {
  await ensureTables();
  const pool = await getPool();
  await pool.request().input('dt', sql.NVarChar(30), docType).query('DELETE FROM drafting_guides WHERE doc_type = @dt');
}
