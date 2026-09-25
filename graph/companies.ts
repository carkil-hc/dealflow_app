// Read a dealflow company record from Azure SQL (the seed for collection).
import { sql } from './db.js';
import type { ConnectionPool } from 'mssql';

export interface CompanyRow {
  id: string;
  name: string;
  description: string | null;
  therapeuticArea: string | null;
}

export async function getCompanyRow(pool: ConnectionPool, id: string): Promise<CompanyRow | null> {
  const r = await pool.request().input('id', sql.NVarChar(50), id)
    .query('SELECT id, name, description, therapeutic_area FROM companies WHERE id = @id');
  const row = r.recordset[0];
  if (!row) return null;
  return { id: row.id, name: row.name, description: row.description ?? null, therapeuticArea: row.therapeutic_area ?? null };
}
