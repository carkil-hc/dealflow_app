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
