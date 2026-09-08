import sql from 'mssql';
import { getPool } from './db.js';

// Maps a sent DocuSign envelope to the company/doc it belongs to, so the
// completion webhook can save the signed PDF back to the right SharePoint folder.
export interface EnvelopeRow {
  companyId: string;
  companyName: string;
  docType: 'proposal' | 'recommendation';
  savedAt: string | null;
}

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const pool = await getPool();
  await pool.request().batch(`
    IF OBJECT_ID('envelope_signings','U') IS NULL
      CREATE TABLE envelope_signings (
        envelope_id  NVARCHAR(50)  NOT NULL PRIMARY KEY,
        company_id   NVARCHAR(50)  NOT NULL,
        company_name NVARCHAR(200) NOT NULL,
        doc_type     NVARCHAR(30)  NOT NULL,
        created_at   NVARCHAR(30)  NOT NULL,
        saved_at     NVARCHAR(30)  NULL
      );
  `);
  tableReady = true;
}

export async function recordEnvelope(envelopeId: string, companyId: string, companyName: string, docType: 'proposal' | 'recommendation'): Promise<void> {
  await ensureTable();
  const pool = await getPool();
  await pool.request()
    .input('e', sql.NVarChar(50), envelopeId)
    .input('c', sql.NVarChar(50), companyId)
    .input('n', sql.NVarChar(200), companyName)
    .input('dt', sql.NVarChar(30), docType)
    .input('at', sql.NVarChar(30), new Date().toISOString())
    .query(`MERGE envelope_signings AS t
      USING (SELECT @e AS envelope_id) AS s ON t.envelope_id = s.envelope_id
      WHEN MATCHED THEN UPDATE SET company_id = @c, company_name = @n, doc_type = @dt, created_at = @at, saved_at = NULL
      WHEN NOT MATCHED THEN INSERT (envelope_id, company_id, company_name, doc_type, created_at)
        VALUES (@e, @c, @n, @dt, @at);`);
}

export async function getEnvelope(envelopeId: string): Promise<EnvelopeRow | null> {
  await ensureTable();
  const pool = await getPool();
  const r = await pool.request()
    .input('e', sql.NVarChar(50), envelopeId)
    .query('SELECT company_id, company_name, doc_type, saved_at FROM envelope_signings WHERE envelope_id = @e');
  const row = r.recordset[0];
  if (!row) return null;
  return { companyId: row.company_id, companyName: row.company_name, docType: row.doc_type, savedAt: row.saved_at ?? null };
}

// Envelopes for a company that haven't had their signed PDF saved yet.
export async function getPendingEnvelopes(companyId: string): Promise<{ envelopeId: string; companyName: string; docType: 'proposal' | 'recommendation' }[]> {
  await ensureTable();
  const pool = await getPool();
  const r = await pool.request()
    .input('c', sql.NVarChar(50), companyId)
    .query('SELECT envelope_id, company_name, doc_type FROM envelope_signings WHERE company_id = @c AND saved_at IS NULL');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return r.recordset.map((row: any) => ({ envelopeId: row.envelope_id, companyName: row.company_name, docType: row.doc_type }));
}

export async function markEnvelopeSaved(envelopeId: string): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('e', sql.NVarChar(50), envelopeId)
    .input('at', sql.NVarChar(30), new Date().toISOString())
    .query('UPDATE envelope_signings SET saved_at = @at WHERE envelope_id = @e');
}
