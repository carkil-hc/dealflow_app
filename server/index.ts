import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import PptxGenJS from 'pptxgenjs';
import 'dotenv/config';
import { getPool } from './db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });


const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCompany(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    stage: row.stage,
    website: row.website ?? undefined,
    sector: row.sector ?? undefined,
    location: row.location ?? undefined,
    therapeuticArea: row.therapeutic_area ?? undefined,
    developmentStage: row.development_stage ?? undefined,
    nextMilestone: row.next_milestone ?? undefined,
    fundingStage: row.funding_stage ?? undefined,
    askAmount: row.ask_amount ?? undefined,
    valuation: row.valuation ?? undefined,
    strategy: row.strategy ?? undefined,
    owner: row.owner ?? undefined,
    backburnerReminder: row.backburner_reminder ?? undefined,
    leadContact: row.lead_contact ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    noteEntries: JSON.parse(row.note_entries || '[]'),
    attachments: JSON.parse(row.attachments || '[]'),
    history: JSON.parse(row.history || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rejectedReason: row.rejected_reason ?? undefined,
    rejectedAt: row.rejected_at ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertOne(pool: sql.ConnectionPool, c: any) {
  await pool.request()
    .input('id', sql.NVarChar(50), c.id)
    .input('name', sql.NVarChar(200), c.name)
    .input('description', sql.NVarChar(sql.MAX), c.description ?? '')
    .input('stage', sql.NVarChar(50), c.stage)
    .input('website', sql.NVarChar(500), c.website ?? null)
    .input('sector', sql.NVarChar(100), c.sector ?? null)
    .input('location', sql.NVarChar(100), c.location ?? null)
    .input('therapeutic_area', sql.NVarChar(100), c.therapeuticArea ?? null)
    .input('development_stage', sql.NVarChar(100), c.developmentStage ?? null)
    .input('next_milestone', sql.NVarChar(200), c.nextMilestone ?? null)
    .input('funding_stage', sql.NVarChar(100), c.fundingStage ?? null)
    .input('ask_amount', sql.NVarChar(100), c.askAmount ?? null)
    .input('valuation', sql.NVarChar(100), c.valuation ?? null)
    .input('strategy', sql.NVarChar(50), c.strategy ?? null)
    .input('owner', sql.NVarChar(200), c.owner ?? null)
    .input('backburner_reminder', sql.NVarChar(20), c.backburnerReminder ?? null)
    .input('lead_contact', sql.NVarChar(200), c.leadContact ?? null)
    .input('email', sql.NVarChar(200), c.email ?? null)
    .input('phone', sql.NVarChar(50), c.phone ?? null)
    .input('note_entries', sql.NVarChar(sql.MAX), JSON.stringify(c.noteEntries ?? []))
    .input('attachments', sql.NVarChar(sql.MAX), JSON.stringify(c.attachments ?? []))
    .input('history', sql.NVarChar(sql.MAX), JSON.stringify(c.history ?? []))
    .input('created_at', sql.NVarChar(30), c.createdAt)
    .input('updated_at', sql.NVarChar(30), c.updatedAt)
    .input('rejected_reason', sql.NVarChar(500), c.rejectedReason ?? null)
    .input('rejected_at', sql.NVarChar(30), c.rejectedAt ?? null)
    .query(`
      MERGE companies AS target
      USING (SELECT @id AS id) AS source ON target.id = source.id
      WHEN MATCHED THEN UPDATE SET
        name=@name, description=@description, stage=@stage,
        website=@website, sector=@sector, location=@location,
        therapeutic_area=@therapeutic_area, development_stage=@development_stage,
        next_milestone=@next_milestone, funding_stage=@funding_stage,
        ask_amount=@ask_amount, valuation=@valuation, strategy=@strategy, owner=@owner,
        backburner_reminder=@backburner_reminder, lead_contact=@lead_contact,
        email=@email, phone=@phone, note_entries=@note_entries,
        attachments=@attachments, history=@history,
        created_at=@created_at, updated_at=@updated_at,
        rejected_reason=@rejected_reason, rejected_at=@rejected_at
      WHEN NOT MATCHED THEN INSERT (
        id,name,description,stage,website,sector,location,
        therapeutic_area,development_stage,next_milestone,funding_stage,
        ask_amount,valuation,strategy,owner,backburner_reminder,lead_contact,
        email,phone,note_entries,attachments,history,
        created_at,updated_at,rejected_reason,rejected_at
      ) VALUES (
        @id,@name,@description,@stage,@website,@sector,@location,
        @therapeutic_area,@development_stage,@next_milestone,@funding_stage,
        @ask_amount,@valuation,@strategy,@owner,@backburner_reminder,@lead_contact,
        @email,@phone,@note_entries,@attachments,@history,
        @created_at,@updated_at,@rejected_reason,@rejected_at
      );
    `);
}


// GET /api/me — returns the logged-in user's display name and email from Easy Auth headers.
// Returns { name: null, email: null } when running locally without Easy Auth.
app.get('/api/me', (req, res) => {
  const principal = req.headers['x-ms-client-principal'];
  if (!principal || typeof principal !== 'string') {
    res.json({ name: null, email: null });
    return;
  }
  try {
    const decoded = JSON.parse(Buffer.from(principal, 'base64').toString('utf8'));
    const claims: Array<{ typ: string; val: string }> = decoded.claims ?? [];
    const find = (...types: string[]) => claims.find(c => types.includes(c.typ))?.val ?? null;
    const name = find(
      'name',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    );
    const email = find(
      'preferred_username',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    );
    res.json({ name, email });
  } catch {
    res.json({ name: null, email: null });
  }
});

// GET all companies
app.get('/api/companies', async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query('SELECT * FROM companies ORDER BY created_at DESC');
    res.json(result.recordset.map(rowToCompany));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// POST — create/update a single company (used by Power Automate)
// Requires X-API-Key header matching the INGEST_API_KEY env var
app.post('/api/companies', async (req, res) => {
  const apiKey = process.env.INGEST_API_KEY;
  if (apiKey && req.headers['x-api-key'] !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const pool = await getPool();
    await upsertOne(pool, req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save company' });
  }
});

// PUT /:id — update a single company (used by the app)
app.put('/api/companies/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await upsertOne(pool, { ...req.body, id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

// DELETE /:id
app.delete('/api/companies/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.NVarChar(50), req.params.id)
      .query('DELETE FROM companies WHERE id = @id');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete company' });
  }
});

// Derive a display name from a healthcap.eu sender address.
// "carl.kilander@healthcap.eu"  →  "Carl"
// Falls back to 'Inbound' for any other format.
function ownerFromSender(from: string | undefined): string {
  if (!from) return 'Inbound';
  const match = from.match(/([a-zA-Z0-9._%+-]+)@healthcap\.eu/i);
  if (!match) return 'Inbound';
  const firstName = match[1].split('.')[0];
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

// POST /api/ingest-pitch-deck — called by Power Automate with email + attachment
// Power Automate sends one request; this endpoint calls Claude and creates the company
app.post('/api/ingest-pitch-deck', async (req, res) => {
  const apiKey = process.env.INGEST_API_KEY;
  if (apiKey && req.headers['x-api-key'] !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const { subject, body, from, attachment, attachmentName, attachmentType } = req.body;

    // Detect whether the attachment is actually a PDF.
    // PDF files start with "%PDF" → base64 prefix "JVBER".
    // Power Automate sometimes sends inline images (JPEG = "/9j/", PNG = "iVBOR") instead.
    const isPdf = (data: string) => data.trimStart().startsWith('JVBER');

    const hasPdf = attachment && typeof attachment === 'string' && attachment.length > 0 && isPdf(attachment);

    // Build message content — include PDF only if it is actually a PDF
    const content: Anthropic.MessageParam['content'] = [];
    if (hasPdf) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: attachment },
      } as Anthropic.DocumentBlockParam);
    }

    const hasAttachmentNote = !hasPdf && attachment && attachment.length > 0
      ? `\nNote: An attachment was provided but it does not appear to be a PDF (possibly an inline image). Extract as much as possible from the email subject and body alone.`
      : '';

    content.push({
      type: 'text',
      text: `You are processing an inbound pitch deck for a healthcare/life science VC firm.\n\nEmail subject: ${subject ?? ''}\nEmail body: ${body ?? ''}\nSender: ${from ?? ''}${hasAttachmentNote}\n\nRead the pitch deck carefully and extract company information. Return ONLY a valid JSON object with these exact fields (use null for anything you cannot determine):\n\n{"name":"Company legal or trade name","description":"2-3 sentence summary of what the company does and its key value proposition","website":"URL if present, else null","sector":"exactly one of: Pharmaceutical, Medtech, Healthtech, Tool, Other","location":"country name only","therapeuticArea":"the primary disease area or therapeutic indication (e.g. Oncology, CNS, Cardiology, Rare Disease, Immunology, Infectious Disease, etc.) — look for disease names, indications, and patient populations throughout the deck","developmentStage":"exactly one of: Preclinical, IND-stage, Phase I, Phase II, Phase III, Marketed — look for pipeline tables, clinical section headings, and regulatory status","nextMilestone":"the single most important upcoming milestone (e.g. IND filing, Phase I start, Phase II data readout, regulatory approval) — look for roadmap/timeline slides","fundingStage":"exactly one of: Seed, Series A, Series B, Series C+, IPO, Public — or null","askAmount":"the amount they are raising in this round, as a string (e.g. €10M, $15M) — or null","valuation":"pre-money or post-money valuation if stated — or null","leadContact":"full name of main contact person","email":"contact email address","phone":"contact phone number"}`,
    });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',   // Sonnet: same accuracy for extraction, 4-5× faster than Opus
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text from Claude');

    // Extract JSON from Claude's response (strip any markdown fences)
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`No JSON in Claude response. Raw response: ${textBlock.text.slice(0, 300)}`);
    const extracted = JSON.parse(jsonMatch[0]);

    const now = new Date().toISOString();

    // Build attachments array — only store the attachment if it is actually a PDF
    const attachments: Array<{ id: string; name: string; type: string; size: number; uploadedAt: string; data?: string }> = [];
    if (hasPdf) {
      const pdfBytes = Buffer.from(attachment, 'base64');
      const rawName = attachmentName && typeof attachmentName === 'string' && attachmentName.trim()
        ? attachmentName.trim()
        : (subject && subject.trim()) ? `${subject.trim().replace(/[^a-z0-9 _-]/gi, '_')}.pdf` : 'pitch-deck.pdf';
      attachments.push({
        id: `${Date.now()}-att`,
        name: rawName,
        type: 'application/pdf',
        size: pdfBytes.length,
        uploadedAt: now,
        data: attachment,   // store base64 so the browser can download it directly
      });
    }

    const straightToReject = typeof body === 'string' && /straight to reject/i.test(body);
    const company = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stage: straightToReject ? 'rejected' : 'new',
      strategy: 'N/a',
      owner: ownerFromSender(from),
      ...(straightToReject ? { rejectedReason: 'Straight to reject', rejectedAt: now } : {}),
      noteEntries: [],
      attachments,
      history: [{ id: `${Date.now()}-h`, type: 'created', timestamp: now, user: 'Power Automate' }],
      createdAt: now,
      updatedAt: now,
      ...extracted,
    };

    const pool = await getPool();
    await upsertOne(pool, company);
    res.json({ ok: true, company });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ingest-pitch-deck]', message);
    res.status(500).json({ error: 'Failed to process pitch deck', detail: message });
  }
});

// ── Competitive Landscape helpers ─────────────────────────────────────────────

interface CompetitiveProgram {
  company: string;
  program: string;
  indication: string;
  stage: string;
  modality: string;
}

interface CompetitiveLandscapeData {
  marketOverview: string;
  competitivePrograms: CompetitiveProgram[];
  differentiation: string[];
  competitiveRisks: string[];
  overallAssessment: string;
}

async function buildCompetitiveLandscapePptx(
  companyName: string,
  data: CompetitiveLandscapeData,
): Promise<string> {
  const TEAL = '005B6E';
  const WHITE = 'FFFFFF';
  const DARK = '1A1A1A';
  const LIGHT_TEAL = 'E0F0F5';
  const GRAY = 'F5F5F5';
  const MID_GRAY = '9CA3AF';

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches

  // ── Slide 1: Title ───────────────────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: TEAL };

    // HealthCap wordmark area (top-left accent bar)
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.08, h: 7.5, fill: { color: WHITE }, line: { color: WHITE, width: 0 },
    });

    slide.addText('HealthCap', {
      x: 0.3, y: 0.35, w: 3, h: 0.4,
      fontSize: 14, bold: true, color: WHITE, fontFace: 'Calibri',
    });

    slide.addText('COMPETITIVE LANDSCAPE', {
      x: 0.3, y: 1.6, w: 12.7, h: 0.7,
      fontSize: 36, bold: true, color: WHITE, fontFace: 'Calibri',
    });

    slide.addText(companyName, {
      x: 0.3, y: 2.4, w: 12.7, h: 0.7,
      fontSize: 28, bold: false, color: LIGHT_TEAL, fontFace: 'Calibri',
    });

    slide.addText(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, {
      x: 0.3, y: 6.9, w: 12.7, h: 0.35,
      fontSize: 10, color: LIGHT_TEAL, fontFace: 'Calibri',
    });
  }

  // ── Slide 2: Market Overview ─────────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Market Overview', {
      x: 0.4, y: 0.15, w: 10, h: 0.7,
      fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    slide.addText(companyName, {
      x: 9.5, y: 0.2, w: 3.5, h: 0.6,
      fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right',
    });

    // Body
    slide.addText(data.marketOverview, {
      x: 0.4, y: 1.25, w: 12.5, h: 5.8,
      fontSize: 14, color: DARK, fontFace: 'Calibri', valign: 'top',
      wrap: true,
    });

    // Footer line
    slide.addShape(pptx.ShapeType.line, {
      x: 0.4, y: 7.15, w: 12.53, h: 0,
      line: { color: LIGHT_TEAL, width: 1 },
    });
    slide.addText('HealthCap — Confidential', {
      x: 0.4, y: 7.2, w: 12.5, h: 0.25,
      fontSize: 8, color: MID_GRAY, fontFace: 'Calibri',
    });
  }

  // ── Slide 3: Competitive Programs ────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Competitive Programs', {
      x: 0.4, y: 0.15, w: 10, h: 0.7,
      fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    slide.addText(companyName, {
      x: 9.5, y: 0.2, w: 3.5, h: 0.6,
      fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right',
    });

    // Table — one row per program
    const colW = [3.0, 2.2, 2.8, 1.8, 3.13]; // Company | Program | Indication | Stage | Modality
    const headers = ['Company', 'Program', 'Indication', 'Stage', 'Modality / Notes'];

    const tableRows: PptxGenJS.TableRow[] = [
      // Header row
      headers.map(h => ({
        text: h,
        options: {
          bold: true,
          color: WHITE,
          fill: { color: TEAL },
          fontSize: 10,
          fontFace: 'Calibri',
          align: 'center' as const,
          valign: 'middle' as const,
        },
      })),
      // Data rows — one per program
      ...data.competitivePrograms.map((p, i) => {
        const isTarget = p.company.toLowerCase().includes(companyName.toLowerCase());
        const rowFill = isTarget ? LIGHT_TEAL : (i % 2 === 0 ? WHITE : GRAY);
        return [p.company, p.program, p.indication, p.stage, p.modality].map(cell => ({
          text: cell || '—',
          options: {
            bold: isTarget,
            color: DARK,
            fill: { color: rowFill },
            fontSize: 9,
            fontFace: 'Calibri',
            align: 'left' as const,
            valign: 'middle' as const,
          },
        }));
      }),
    ];

    slide.addTable(tableRows, {
      x: 0.4, y: 1.15, w: 12.53,
      rowH: 0.35,
      colW,
      border: { type: 'solid', color: LIGHT_TEAL, pt: 0.5 },
    });

    // Footer
    slide.addShape(pptx.ShapeType.line, {
      x: 0.4, y: 7.15, w: 12.53, h: 0,
      line: { color: LIGHT_TEAL, width: 1 },
    });
    slide.addText('HealthCap — Confidential', {
      x: 0.4, y: 7.2, w: 12.5, h: 0.25,
      fontSize: 8, color: MID_GRAY, fontFace: 'Calibri',
    });
  }

  // ── Slide 4: Differentiation & Risks ─────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Differentiation & Competitive Risks', {
      x: 0.4, y: 0.15, w: 10, h: 0.7,
      fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    slide.addText(companyName, {
      x: 9.5, y: 0.2, w: 3.5, h: 0.6,
      fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right',
    });

    // Left column: Differentiation
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 1.15, w: 5.9, h: 0.45,
      fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Differentiation', {
      x: 0.4, y: 1.15, w: 5.9, h: 0.45,
      fontSize: 12, bold: true, color: WHITE, fontFace: 'Calibri', align: 'center', valign: 'middle',
    });

    const diffItems = data.differentiation.map(d => ({ text: d, options: { bullet: { indent: 10 }, paraSpaceAfter: 6 } }));
    slide.addText(diffItems, {
      x: 0.4, y: 1.65, w: 5.9, h: 5.15,
      fontSize: 11, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true,
    });

    // Right column: Risks
    slide.addShape(pptx.ShapeType.rect, {
      x: 7.0, y: 1.15, w: 5.9, h: 0.45,
      fill: { color: '9B1C1C' }, line: { color: '9B1C1C', width: 0 },
    });
    slide.addText('Competitive Risks', {
      x: 7.0, y: 1.15, w: 5.9, h: 0.45,
      fontSize: 12, bold: true, color: WHITE, fontFace: 'Calibri', align: 'center', valign: 'middle',
    });

    const riskItems = data.competitiveRisks.map(r => ({ text: r, options: { bullet: { indent: 10 }, paraSpaceAfter: 6 } }));
    slide.addText(riskItems, {
      x: 7.0, y: 1.65, w: 5.9, h: 5.15,
      fontSize: 11, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true,
    });

    // Divider line between columns
    slide.addShape(pptx.ShapeType.line, {
      x: 6.67, y: 1.15, w: 0, h: 5.65,
      line: { color: LIGHT_TEAL, width: 1 },
    });

    // Footer
    slide.addShape(pptx.ShapeType.line, {
      x: 0.4, y: 7.15, w: 12.53, h: 0,
      line: { color: LIGHT_TEAL, width: 1 },
    });
    slide.addText('HealthCap — Confidential', {
      x: 0.4, y: 7.2, w: 12.5, h: 0.25,
      fontSize: 8, color: MID_GRAY, fontFace: 'Calibri',
    });
  }

  // ── Slide 5: Overall Assessment ──────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Overall Assessment', {
      x: 0.4, y: 0.15, w: 10, h: 0.7,
      fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    slide.addText(companyName, {
      x: 9.5, y: 0.2, w: 3.5, h: 0.6,
      fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right',
    });

    // Light accent box
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 1.15, w: 12.53, h: 5.7,
      fill: { color: GRAY }, line: { color: LIGHT_TEAL, width: 1 },
    });
    // Teal left accent
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 1.15, w: 0.12, h: 5.7,
      fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });

    slide.addText(data.overallAssessment, {
      x: 0.75, y: 1.35, w: 11.9, h: 5.3,
      fontSize: 14, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true,
    });

    // Footer
    slide.addShape(pptx.ShapeType.line, {
      x: 0.4, y: 7.15, w: 12.53, h: 0,
      line: { color: LIGHT_TEAL, width: 1 },
    });
    slide.addText('HealthCap — Confidential', {
      x: 0.4, y: 7.2, w: 12.5, h: 0.25,
      fontSize: 8, color: MID_GRAY, fontFace: 'Calibri',
    });
  }

  const base64 = await pptx.write({ outputType: 'base64' }) as string;
  return base64;
}

// POST /api/companies/:id/reports/competitive-landscape
// Generates a competitive landscape analysis for the company using Claude,
// saves the result as a PPTX in the company's Files tab, and returns the report text.
app.post('/api/companies/:id/reports/competitive-landscape', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar(50), req.params.id)
      .query('SELECT * FROM companies WHERE id = @id');
    if (result.recordset.length === 0) { res.status(404).json({ error: 'Company not found' }); return; }
    const c = rowToCompany(result.recordset[0]);

    const prompt = `You are a healthcare and life science venture capital analyst at HealthCap, a leading Nordic life science VC firm.

Analyse the competitive landscape for the following company and return ONLY a valid JSON object — no markdown fences, no prose outside the JSON.

Company: ${c.name}
Description: ${c.description || 'N/A'}
Sector: ${c.sector || 'N/A'}
Therapeutic Area: ${c.therapeuticArea || 'N/A'}
Development Stage: ${c.developmentStage || 'N/A'}
Location: ${c.location || 'N/A'}
Website: ${c.website || 'N/A'}

Return this exact JSON structure:
{
  "marketOverview": "2-4 sentence description of the market/indication, addressable patient population, and unmet medical need",
  "competitivePrograms": [
    {
      "company": "Company name (put ${c.name} as the first entry)",
      "program": "Asset or program name / code (e.g. drug name, platform, or 'Undisclosed')",
      "indication": "Primary indication or disease area",
      "stage": "Development stage (e.g. Preclinical, IND-stage, Phase I, Phase II, Phase III, Marketed)",
      "modality": "Modality or mechanism of action (e.g. mAb, ADC, small molecule, gene therapy, cell therapy, etc.)"
    }
  ],
  "differentiation": [
    "Differentiator point 1 — be specific",
    "Differentiator point 2",
    "Differentiator point 3"
  ],
  "competitiveRisks": [
    "Risk 1 — be specific about the competitive threat",
    "Risk 2",
    "Risk 3"
  ],
  "overallAssessment": "2-3 sentence summary of ${c.name}'s competitive position, highlighting the key opportunity and the most significant challenge."
}

Rules:
- List EVERY major competitor program as a separate entry in competitivePrograms (one entry = one development program)
- If a company has multiple programs in the same indication, list each separately
- Be specific — use real company/drug names where known
- If data is limited, note this in the overallAssessment`;

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');

    // Extract JSON
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');
    const data: CompetitiveLandscapeData = JSON.parse(jsonMatch[0]);

    // Build human-readable text report (shown in the DD Reports card)
    const report = [
      `COMPETITIVE LANDSCAPE: ${c.name}`,
      '',
      '── MARKET OVERVIEW ──',
      data.marketOverview,
      '',
      '── COMPETITIVE PROGRAMS ──',
      ['Company', 'Program', 'Indication', 'Stage', 'Modality'].join(' | '),
      ...data.competitivePrograms.map(p =>
        [p.company, p.program, p.indication, p.stage, p.modality].join(' | ')
      ),
      '',
      `── ${c.name.toUpperCase()} DIFFERENTIATION ──`,
      ...data.differentiation.map(d => `• ${d}`),
      '',
      '── COMPETITIVE RISKS ──',
      ...data.competitiveRisks.map(r => `• ${r}`),
      '',
      '── OVERALL ASSESSMENT ──',
      data.overallAssessment,
    ].join('\n');

    // Generate PPTX
    const pptxBase64 = await buildCompetitiveLandscapePptx(c.name, data);
    const pptxBytes = Buffer.from(pptxBase64, 'base64');
    const now = new Date().toISOString();
    const safeName = c.name.replace(/[^a-z0-9 _-]/gi, '_');
    const fileName = `${safeName} — Competitive Landscape.pptx`;
    const newAttachment = {
      id: `${Date.now()}-cl`,
      name: fileName,
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: pptxBytes.length,
      uploadedAt: now,
      data: pptxBase64,
    };

    // Persist the new attachment to the database (append to existing attachments)
    const existingAtts: typeof c.attachments = c.attachments ?? [];
    const updatedAtts = [...existingAtts, newAttachment];
    await pool.request()
      .input('id', sql.NVarChar(50), c.id)
      .input('attachments', sql.NVarChar(sql.MAX), JSON.stringify(updatedAtts))
      .input('updated_at', sql.NVarChar(30), now)
      .query('UPDATE companies SET attachments = @attachments, updated_at = @updated_at WHERE id = @id');

    res.json({ report, attachment: newAttachment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Serve the built React app for all non-API routes in production
if (isProd) {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
