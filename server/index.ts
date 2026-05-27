import express from 'express';
import cors from 'cors';
import sql from 'mssql';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
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
    const { subject, body, from, attachment } = req.body;

    // Build message content — include PDF if attachment provided
    const content: Anthropic.MessageParam['content'] = [];
    if (attachment && typeof attachment === 'string' && attachment.length > 0) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: attachment },
      } as Anthropic.DocumentBlockParam);
    }
    content.push({
      type: 'text',
      text: `You are processing an inbound pitch deck for a healthcare/life science VC firm.\n\nEmail subject: ${subject ?? ''}\nEmail body: ${body ?? ''}\nSender: ${from ?? ''}\n\nRead the pitch deck carefully and extract company information. Return ONLY a valid JSON object with these exact fields (use null for anything you cannot determine):\n\n{"name":"Company legal or trade name","description":"2-3 sentence summary of what the company does and its key value proposition","website":"URL if present, else null","sector":"exactly one of: Pharmaceutical, Medtech, Healthtech, Tool, Other","location":"country name only","therapeuticArea":"the primary disease area or therapeutic indication (e.g. Oncology, CNS, Cardiology, Rare Disease, Immunology, Infectious Disease, etc.) — look for disease names, indications, and patient populations throughout the deck","developmentStage":"exactly one of: Preclinical, IND-stage, Phase I, Phase II, Phase III, Marketed — look for pipeline tables, clinical section headings, and regulatory status","nextMilestone":"the single most important upcoming milestone (e.g. IND filing, Phase I start, Phase II data readout, regulatory approval) — look for roadmap/timeline slides","fundingStage":"exactly one of: Seed, Series A, Series B, Series C+, IPO, Public — or null","askAmount":"the amount they are raising in this round, as a string (e.g. €10M, $15M) — or null","valuation":"pre-money or post-money valuation if stated — or null","leadContact":"full name of main contact person","email":"contact email address","phone":"contact phone number"}`,
    });

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    const textBlock = message.content.find(c => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text from Claude');

    // Extract JSON from Claude's response (strip any markdown fences)
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');
    const extracted = JSON.parse(jsonMatch[0]);

    const now = new Date().toISOString();

    // Build attachments array — include the original pitch deck PDF if one was provided
    const attachments: Array<{ id: string; name: string; type: string; size: number; uploadedAt: string; data?: string }> = [];
    if (attachment && typeof attachment === 'string' && attachment.length > 0) {
      const pdfBytes = Buffer.from(attachment, 'base64');
      const fileName = (subject && subject.trim()) ? `${subject.trim().replace(/[^a-z0-9 _-]/gi, '_')}.pdf` : 'pitch-deck.pdf';
      attachments.push({
        id: `${Date.now()}-att`,
        name: fileName,
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
    console.error(err);
    res.status(500).json({ error: 'Failed to process pitch deck' });
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
