import { Router } from 'express';
import sql from 'mssql';
import { getPool } from './db.js';

// ── Row ⇄ Company mapping ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToCompany(row: Record<string, any>) {
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

// Insert or update one company (MERGE on id).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertOne(pool: sql.ConnectionPool, c: any) {
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

// ── Routes ─────────────────────────────────────────────────────────────────

export const companiesRouter = Router();

// GET all companies
companiesRouter.get('/api/companies', async (_req, res) => {
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
companiesRouter.post('/api/companies', async (req, res) => {
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
companiesRouter.put('/api/companies/:id', async (req, res) => {
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
companiesRouter.delete('/api/companies/:id', async (req, res) => {
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
