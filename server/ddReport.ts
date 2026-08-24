import { Router } from 'express';
import { createRequire } from 'node:module';
import sql from 'mssql';
import Anthropic from '@anthropic-ai/sdk';
import type PptxGenJS from 'pptxgenjs';
import { getPool } from './db.js';
import { anthropic } from './anthropic.js';
import { rowToCompany } from './companies.js';
import {
  newDeck, toBase64, footer, headerBar, coverSlide,
  TEAL, WHITE, DARK, LIGHT_TEAL, GRAY, MID_GRAY, RISK_COLOR, RISK_LABEL,
} from './pptx.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const { parseOffice } = require('officeparser') as { parseOffice: (input: Buffer) => Promise<any> };

// Office document mime types officeparser can extract text from.
const OFFICE_TYPES: Record<string, true> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true, // docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': true, // pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true, // xlsx
  'application/msword': true,
  'application/vnd.ms-powerpoint': true,
  'application/vnd.ms-excel': true,
};
function isOfficeType(type: string, name: string): boolean {
  if (OFFICE_TYPES[type]) return true;
  return /\.(docx?|pptx?|xlsx?)$/i.test(name || '');
}

// ── Content shapes ───────────────────────────────────────────────────────────
interface DimContent {
  category: string;
  question: string;
  riskLevel: number | null;
  hasData: boolean;
  summary: string;
  mainFindings: string[];
  detail: { heading: string; body: string }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;

function riskBadge(pptx: PptxGenJS, slide: Slide, level: number | null, x: number, y: number) {
  const color = level ? RISK_COLOR[level] : '9CA3AF';
  const label = level ? `RISK ${level} / 5 · ${RISK_LABEL[level]}` : 'NOT ASSESSED';
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.2, h: 0.5, rectRadius: 0.05, fill: { color }, line: { color, width: 0 } });
  slide.addText(label, { x, y, w: 3.2, h: 0.5, fontSize: 12, bold: true, color: WHITE, fontFace: 'Calibri', align: 'center', valign: 'middle' });
}

// Add a dimension's slides (summary + up to 3 detail) — max 4, no cover slide.
function addDimensionSlides(pptx: PptxGenJS, companyName: string, dim: DimContent) {
  // ── Summary slide ──
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  headerBar(pptx, s, dim.category, companyName);
  s.addText(dim.question, { x: 0.4, y: 1.15, w: 12.5, h: 0.5, fontSize: 12, italic: true, color: MID_GRAY, fontFace: 'Calibri', valign: 'top' });

  if (!dim.hasData) {
    s.addText('No data yet — add or edit data in the app.', {
      x: 0.4, y: 2.8, w: 12.5, h: 1.2, fontSize: 20, bold: true, color: MID_GRAY, fontFace: 'Calibri', align: 'center',
    });
    footer(pptx, s);
    return;
  }

  riskBadge(pptx, s, dim.riskLevel, 0.4, 1.75);

  if (dim.summary) {
    s.addText(dim.summary, { x: 0.4, y: 2.45, w: 12.5, h: 1.3, fontSize: 14, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true });
  }

  if (dim.mainFindings.length) {
    s.addText('Main findings', { x: 0.4, y: 3.75, w: 12.5, h: 0.35, fontSize: 13, bold: true, color: TEAL, fontFace: 'Calibri' });
    s.addText(
      dim.mainFindings.slice(0, 6).map(t => ({ text: t, options: { bullet: { indent: 12 }, paraSpaceAfter: 6 } })),
      { x: 0.4, y: 4.15, w: 12.5, h: 2.85, fontSize: 13, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true },
    );
  }
  footer(pptx, s);

  // ── Detail slides (max 3) ──
  for (const section of dim.detail.slice(0, 3)) {
    const d = pptx.addSlide();
    d.background = { color: WHITE };
    headerBar(pptx, d, `${dim.category} — detail`, companyName);
    d.addText(section.heading, { x: 0.4, y: 1.2, w: 12.5, h: 0.5, fontSize: 15, bold: true, color: TEAL, fontFace: 'Calibri' });
    d.addText(section.body, { x: 0.4, y: 1.8, w: 12.5, h: 5.2, fontSize: 13, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true });
    footer(pptx, d);
  }
}

// Single-dimension deck (summary slide first, no cover).
export async function buildDimensionDeck(companyName: string, dim: DimContent): Promise<string> {
  const pptx = newDeck();
  addDimensionSlides(pptx, companyName, dim);
  return toBase64(pptx);
}

// Combined deck: cover + overview table + every dimension's slides.
export async function buildCombinedDeck(companyName: string, dims: DimContent[]): Promise<string> {
  const pptx = newDeck();
  coverSlide(pptx, 'DUE DILIGENCE SUMMARY', companyName);

  // Overview table
  {
    const o = pptx.addSlide();
    o.background = { color: WHITE };
    headerBar(pptx, o, 'Risk Overview', companyName);
    const rows: PptxGenJS.TableRow[] = [
      ['#', 'Dimension', 'Risk level'].map(h => ({
        text: h, options: { bold: true, color: WHITE, fill: { color: TEAL }, fontSize: 11, fontFace: 'Calibri', valign: 'middle' as const },
      })),
      ...dims.map((d, i) => ([
        { text: String(i + 1), options: { fontSize: 11, color: DARK, fontFace: 'Calibri', align: 'center' as const, fill: { color: i % 2 ? GRAY : WHITE } } },
        { text: d.category, options: { fontSize: 11, color: DARK, fontFace: 'Calibri', fill: { color: i % 2 ? GRAY : WHITE } } },
        {
          text: d.riskLevel ? `${d.riskLevel} / 5 · ${RISK_LABEL[d.riskLevel]}` : 'Not assessed',
          options: { fontSize: 11, bold: !!d.riskLevel, color: d.riskLevel ? RISK_COLOR[d.riskLevel] : MID_GRAY, fontFace: 'Calibri', fill: { color: i % 2 ? GRAY : WHITE } },
        },
      ])),
    ];
    o.addTable(rows, { x: 0.4, y: 1.2, w: 12.53, colW: [0.8, 8.0, 3.73], rowH: 0.45, border: { type: 'solid', color: LIGHT_TEAL, pt: 0.5 } });
    footer(pptx, o);
  }

  for (const dim of dims) addDimensionSlides(pptx, companyName, dim);
  return toBase64(pptx);
}

// ── Claude synthesis ─────────────────────────────────────────────────────────
// For dimensions that have data, turn raw comments/findings into a summary,
// main findings, and up to 3 detail sections. Returns a map keyed by category.
async function synthesize(
  companyName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[],
): Promise<Record<string, { summary: string; mainFindings: string[]; detail: { heading: string; body: string }[] }>> {
  if (items.length === 0) return {};

  const payload = items.map(it => ({
    category: it.category,
    question: it.question,
    riskLevel: it.riskLevel,
    comments: it.comments || '',
    findings: (it.findings || []).map((f: { text: string; sourceRef?: string }) => ({ text: f.text, source: f.sourceRef })),
  }));

  const prompt = `You are a life-science venture capital analyst at HealthCap preparing a due diligence deck for ${companyName}.

For each due-diligence dimension below, turn the raw notes into concise slide content. Return ONLY a valid JSON object keyed by the exact category name, each value:
{
  "summary": "1-2 sentence synthesis of the current assessment for this dimension",
  "mainFindings": ["3-5 short bullet points of the key findings / open questions"],
  "detail": [{"heading": "short heading", "body": "a paragraph of the underlying detail"}]
}
Rules:
- Base everything ONLY on the provided notes; do not invent facts. If notes are thin, keep it brief and say what is missing.
- At most 3 detail sections per dimension (they become slides). Keep each body under ~120 words.
- Do not restate the risk level number.

Dimensions:
${JSON.stringify(payload, null, 2)}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });
  const textBlock = message.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text from Claude');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');
  return JSON.parse(jsonMatch[0]);
}

// ── Route ────────────────────────────────────────────────────────────────────
export const ddReportRouter = Router();

const PHARMA = [
  { category: 'Target biology', question: 'Is the MoA relevant for the disease of interest?' },
  { category: 'Translatability', question: 'Can results from preclinical models reliably be translated to clinical disease?' },
  { category: 'PK / Biodistribution', question: 'Will the molecule reach the target in sufficient quantity?' },
  { category: 'Toxicology', question: 'Is the molecule safe and are there specific tolerability questions?' },
  { category: 'CMC', question: 'Is manufacturing feasible at relevant clinical scale?' },
  { category: 'Clinical development / Regulatory', question: 'Is it possible to prove the TPP in a realistic time, recruit patients, and establish a dosing regimen? Is there a clear regulatory path (endpoints etc)?' },
  { category: 'Commercial', question: 'Market size? Differentiation?' },
  { category: 'Intellectual property', question: 'Is there IP to allow adequate protection from competition?' },
  { category: 'Main differentiator', question: 'What aspect in the technology/target will be the main differentiator to competitors?' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasData(item: any): boolean {
  return !!(item && ((item.comments && item.comments.trim()) || item.riskLevel != null || (item.findings && item.findings.length)));
}

const CATEGORY_NAMES = PHARMA.map(p => p.category);

// POST /api/companies/:id/dd/analyze-files
// Reads the company's PDF/image attachments and drafts DD findings per category
// (proposals — risk levels are only *suggested*, never committed). Returns the
// findings; the client merges and persists them.
ddReportRouter.post('/api/companies/:id/dd/analyze-files', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.NVarChar(50), req.params.id).query('SELECT * FROM companies WHERE id = @id');
    if (result.recordset.length === 0) { res.status(404).json({ error: 'Company not found' }); return; }
    const c = rowToCompany(result.recordset[0]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const atts: any[] = (c.attachments ?? []).filter((a: any) => a && a.data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfs = atts.filter((a: any) => a.type === 'application/pdf');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = atts.filter((a: any) => typeof a.type === 'string' && a.type.startsWith('image/'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const offices = atts.filter((a: any) => isOfficeType(a.type, a.name));

    if (pdfs.length === 0 && images.length === 0 && offices.length === 0) {
      res.status(400).json({ error: 'No analyzable files. Upload PDF, Word, PowerPoint, Excel, or image files to the Files tab first.' });
      return;
    }

    // Cap total document payload (~20MB of base64) to stay within API limits.
    const CAP = 20 * 1024 * 1024;
    const content: Anthropic.MessageParam['content'] = [];
    const included: string[] = [];
    let used = 0;

    // PDFs and images go as native blocks (Claude reads layout + visuals).
    for (const a of [...pdfs, ...images]) {
      if (used + a.data.length > CAP) continue;
      used += a.data.length;
      included.push(a.name);
      if (a.type === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name } as Anthropic.DocumentBlockParam);
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: a.type, data: a.data } } as Anthropic.ImageBlockParam);
      }
    }

    // Office docs: extract text server-side (Claude can't read docx/pptx/xlsx directly).
    for (const a of offices) {
      try {
        const parsed = await parseOffice(Buffer.from(a.data, 'base64'));
        const text = String(parsed.toText() ?? '').trim().slice(0, 60000); // cap per file
        if (text) {
          included.push(a.name);
          content.push({ type: 'text', text: `--- Extracted text from "${a.name}" ---\n${text}` });
        }
      } catch (e) {
        console.error(`[dd analyze-files] could not extract "${a.name}"`, e);
      }
    }

    if (included.length === 0) {
      res.status(400).json({ error: 'Could not read any of the attached files.' });
      return;
    }

    content.push({
      type: 'text',
      text: `You are a life-science VC analyst at HealthCap doing due diligence on ${c.name}${c.therapeuticArea ? ` (${c.therapeuticArea})` : ''}.

Read the attached document(s) [${included.join(', ')}] and extract due-diligence findings, mapped to this fixed framework. Return ONLY a valid JSON array. Each element:
{
  "category": "EXACTLY one of: ${CATEGORY_NAMES.join(' | ')}",
  "text": "a concise, specific finding grounded in the documents (1-2 sentences)",
  "sourceRef": "which document it came from",
  "riskLevelSuggested": 1-5 (1 = low risk / strong, 5 = high risk / weak; omit if you cannot judge)
}

Rules:
- Base every finding ONLY on the documents. Do NOT invent facts. If the documents say nothing about a category, produce no finding for it.
- Multiple findings per category are fine. Keep each finding sharp and evidence-based.
- riskLevelSuggested is a suggestion only.`,
    });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
    });
    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text from Claude');
    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in Claude response');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = JSON.parse(jsonMatch[0]);

    // Keep only findings whose category matches the framework.
    const findings = raw
      .filter(f => f && CATEGORY_NAMES.includes(f.category) && typeof f.text === 'string' && f.text.trim())
      .map(f => ({
        category: f.category,
        text: String(f.text).trim(),
        sourceRef: typeof f.sourceRef === 'string' ? f.sourceRef : (included[0] ?? 'file'),
        riskLevelSuggested: [1, 2, 3, 4, 5].includes(f.riskLevelSuggested) ? f.riskLevelSuggested : undefined,
      }));

    res.json({ findings, analyzedFiles: included });
  } catch (err) {
    console.error('[dd analyze-files]', err);
    res.status(500).json({ error: 'Failed to analyze files', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/companies/:id/dd/pptx  — body { dimension?: string }
// No dimension → combined deck; a dimension category → that single deck.
ddReportRouter.post('/api/companies/:id/dd/pptx', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.NVarChar(50), req.params.id).query('SELECT * FROM companies WHERE id = @id');
    if (result.recordset.length === 0) { res.status(404).json({ error: 'Company not found' }); return; }
    const c = rowToCompany(result.recordset[0]);

    // Merge stored assessment onto the template so every dimension exists.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stored = new Map<string, any>((c.ddAssessment?.items ?? []).map((i: any) => [i.category, i]));
    const merged = PHARMA.map(t => {
      const e = stored.get(t.category);
      return { category: t.category, question: t.question, comments: e?.comments ?? '', riskLevel: e?.riskLevel ?? null, findings: e?.findings ?? [] };
    });

    const single: string | undefined = req.body?.dimension;
    const scope = single ? merged.filter(m => m.category === single) : merged;
    if (single && scope.length === 0) { res.status(400).json({ error: `Unknown dimension: ${single}` }); return; }

    const synths = await synthesize(c.name, scope.filter(hasData));

    const content: DimContent[] = scope.map(m => {
      const has = hasData(m);
      const syn = synths[m.category];
      return {
        category: m.category,
        question: m.question,
        riskLevel: m.riskLevel,
        hasData: has,
        summary: has ? (syn?.summary ?? m.comments) : '',
        mainFindings: has ? (syn?.mainFindings ?? []) : [],
        detail: has ? (syn?.detail ?? (m.comments ? [{ heading: 'Notes', body: m.comments }] : [])) : [],
      };
    });

    const now = new Date().toISOString();
    let data: string, name: string;
    if (single) {
      data = await buildDimensionDeck(c.name, content[0]);
      name = `${c.name.replace(/[^a-z0-9 _-]/gi, '_')} — ${single.replace(/[^a-z0-9 _-]/gi, '_')}.pptx`;
    } else {
      data = await buildCombinedDeck(c.name, content);
      name = `${c.name.replace(/[^a-z0-9 _-]/gi, '_')} — Due Diligence Summary.pptx`;
    }

    const bytes = Buffer.from(data, 'base64');
    const attachment = {
      id: `${Date.now()}-dd`,
      name,
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: bytes.length,
      uploadedAt: now,
      data,
    };

    res.json({ attachment, preview: { combined: !single, dimensions: content } });
  } catch (err) {
    console.error('[dd pptx]', err);
    res.status(500).json({ error: 'Failed to generate DD presentation', detail: err instanceof Error ? err.message : String(err) });
  }
});
