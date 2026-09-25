// Collection job queue (Azure SQL table graph_jobs). Enqueued when a dealflow
// company is created (or on demand); drained by the Container Apps Job worker.
import { sql } from './db.js';
import type { ConnectionPool } from 'mssql';

export async function enqueue(pool: ConnectionPool, companyId: string): Promise<void> {
  const now = new Date().toISOString();
  await pool.request()
    .input('id', sql.NVarChar(50), companyId)
    .input('now', sql.NVarChar(30), now)
    .query(`MERGE graph_jobs AS t USING (SELECT @id AS company_id) AS s ON t.company_id = s.company_id
      WHEN MATCHED THEN UPDATE SET status='pending', enqueued_at=@now, error=NULL
      WHEN NOT MATCHED THEN INSERT (company_id, status, enqueued_at, attempts) VALUES (@id, 'pending', @now, 0);`);
}

// Atomically claim the oldest pending job (pending -> running), returning its id.
export async function claimNext(pool: ConnectionPool): Promise<string | null> {
  const now = new Date().toISOString();
  const r = await pool.request().input('now', sql.NVarChar(30), now).query(`
    UPDATE graph_jobs SET status='running', started_at=@now, attempts=attempts+1
    OUTPUT inserted.company_id
    WHERE company_id = (SELECT TOP 1 company_id FROM graph_jobs WHERE status='pending' ORDER BY enqueued_at);`);
  return r.recordset[0]?.company_id ?? null;
}

export async function complete(pool: ConnectionPool, companyId: string): Promise<void> {
  await pool.request().input('id', sql.NVarChar(50), companyId).input('now', sql.NVarChar(30), new Date().toISOString())
    .query("UPDATE graph_jobs SET status='done', finished_at=@now, error=NULL WHERE company_id=@id");
}

export async function fail(pool: ConnectionPool, companyId: string, err: string): Promise<void> {
  await pool.request().input('id', sql.NVarChar(50), companyId).input('now', sql.NVarChar(30), new Date().toISOString())
    .input('err', sql.NVarChar(1000), err.slice(0, 1000))
    .query("UPDATE graph_jobs SET status='error', finished_at=@now, error=@err WHERE company_id=@id");
}
