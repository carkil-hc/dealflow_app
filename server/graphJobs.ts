// Graph collection job queue — manual enqueue + status (the ingest route enqueues
// automatically; these let a user trigger/inspect collection from the app).
import { Router } from 'express';
import sql from 'mssql';
import { getPool } from './db.js';

export const graphJobsRouter = Router();

// POST /api/companies/:id/collect — queue a collection job for one company.
graphJobsRouter.post('/api/companies/:id/collect', async (req, res) => {
  try {
    const pool = await getPool();
    const now = new Date().toISOString();
    await pool.request().input('id', sql.NVarChar(50), req.params.id).input('now', sql.NVarChar(30), now)
      .query(`MERGE graph_jobs AS t USING (SELECT @id AS company_id) AS s ON t.company_id = s.company_id
        WHEN MATCHED THEN UPDATE SET status='pending', enqueued_at=@now, error=NULL
        WHEN NOT MATCHED THEN INSERT (company_id, status, enqueued_at, attempts) VALUES (@id, 'pending', @now, 0);`);
    res.json({ ok: true, queued: req.params.id });
  } catch (err) {
    console.error('[graph/collect]', err);
    res.status(500).json({ error: 'Failed to queue collection', detail: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/graph/jobs — recent job statuses.
graphJobsRouter.get('/api/graph/jobs', async (_req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT TOP 50 company_id, status, enqueued_at, finished_at, attempts, error FROM graph_jobs ORDER BY enqueued_at DESC');
    res.json({ jobs: r.recordset });
  } catch (err) {
    console.error('[graph/jobs]', err);
    res.status(500).json({ error: 'Failed to list jobs', detail: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/graph/alerts — recent change-detection alerts (optional ?companyId=).
graphJobsRouter.get('/api/graph/alerts', async (req, res) => {
  try {
    const pool = await getPool();
    const r = req.query.companyId
      ? await pool.request().input('cid', sql.NVarChar(100), String(req.query.companyId)).query('SELECT TOP 100 id, slice, company_id, type, severity, title, detail, url, created_at FROM graph_alerts WHERE company_id=@cid ORDER BY id DESC')
      : await pool.request().query('SELECT TOP 100 id, slice, company_id, type, severity, title, detail, url, created_at FROM graph_alerts ORDER BY id DESC');
    res.json({ alerts: r.recordset });
  } catch (err) {
    console.error('[graph/alerts]', err);
    res.status(500).json({ error: 'Failed to list alerts', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/companies/:id/owners { owners: string[], slice? } — assign the project
// people who receive this company's alerts (emails / Teams ids handled by the flow).
graphJobsRouter.post('/api/companies/:id/owners', async (req, res) => {
  try {
    const owners = Array.isArray(req.body?.owners) ? req.body.owners.map((s: unknown) => String(s)) : null;
    if (!owners) return res.status(400).json({ error: 'owners must be an array' });
    const pool = await getPool();
    const now = new Date().toISOString();
    await pool.request().input('id', sql.NVarChar(100), req.params.id).input('slice', sql.NVarChar(100), req.body?.slice ?? null)
      .input('owners', sql.NVarChar(sql.MAX), JSON.stringify(owners)).input('now', sql.NVarChar(30), now)
      .query(`MERGE graph_project_owners AS t USING (SELECT @id AS company_id) AS s ON t.company_id = s.company_id
        WHEN MATCHED THEN UPDATE SET owners=@owners, slice=@slice, updated_at=@now
        WHEN NOT MATCHED THEN INSERT (company_id, slice, owners, updated_at) VALUES (@id, @slice, @owners, @now);`);
    res.json({ ok: true, companyId: req.params.id, owners });
  } catch (err) {
    console.error('[graph/owners]', err);
    res.status(500).json({ error: 'Failed to set owners', detail: err instanceof Error ? err.message : String(err) });
  }
});
