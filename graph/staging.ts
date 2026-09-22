// Staging store: durable, queryable raw-record layer (Azure SQL table
// stg_raw_records). Connectors write raw fetched records here with provenance;
// the loader reads them to resolve + upsert into the graph — so the graph can be
// rebuilt without re-fetching, and every fetch is auditable.
//
// Auth: Azure SQL via AAD token (DefaultAzureCredential = the App Service managed
// identity in prod, or your `az login` locally). Needs AZURE_SQL_SERVER /
// AZURE_SQL_DATABASE in env (same values as the dealflow app).
import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

export interface RawRecord {
  source: string;       // 'clinicaltrials.gov' | 'openalex' | ...
  id: string;           // natural key within the source (NCT id, OpenAlex id, …)
  recordType: string;   // 'trial' | 'author' | ...
  slice: string;        // graph slice (seed disease canonical id)
  url: string;
  payload: unknown;     // the raw record (stored as JSON)
}

const cred = new DefaultAzureCredential();

export class Staging {
  private constructor(private pool: sql.ConnectionPool) {}

  static async open(): Promise<Staging> {
    const server = process.env.AZURE_SQL_SERVER, database = process.env.AZURE_SQL_DATABASE;
    if (!server || !database) throw new Error('AZURE_SQL_SERVER / AZURE_SQL_DATABASE not set');
    const token = (await cred.getToken('https://database.windows.net/.default')).token;
    const pool = await new sql.ConnectionPool({
      server, database,
      options: { encrypt: true, trustServerCertificate: false },
      connectionTimeout: 60000, requestTimeout: 60000,
      authentication: { type: 'azure-active-directory-access-token', options: { token } },
    }).connect();
    return new Staging(pool);
  }

  async close() { await this.pool.close(); }

  // Idempotent upsert of raw records (MERGE on source+id). Payload is retained.
  async put(records: RawRecord[]): Promise<number> {
    const at = new Date().toISOString();
    for (const r of records) {
      await this.pool.request()
        .input('source', sql.NVarChar(50), r.source)
        .input('id', sql.NVarChar(200), r.id)
        .input('rt', sql.NVarChar(50), r.recordType)
        .input('slice', sql.NVarChar(100), r.slice)
        .input('url', sql.NVarChar(1000), r.url)
        .input('at', sql.NVarChar(30), at)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(r.payload))
        .query(`MERGE stg_raw_records AS t
          USING (SELECT @source AS source, @id AS id) AS s ON t.source = s.source AND t.id = s.id
          WHEN MATCHED THEN UPDATE SET record_type=@rt, slice=@slice, url=@url, fetched_at=@at, payload=@payload
          WHEN NOT MATCHED THEN INSERT (source, id, record_type, slice, url, fetched_at, payload)
            VALUES (@source, @id, @rt, @slice, @url, @at, @payload);`);
    }
    return records.length;
  }

  // Read staged payloads back for reprocessing.
  async get<T = unknown>(source: string, opts: { slice?: string; recordType?: string } = {}): Promise<T[]> {
    let q = 'SELECT payload FROM stg_raw_records WHERE source = @source';
    const req = this.pool.request().input('source', sql.NVarChar(50), source);
    if (opts.slice) { q += ' AND slice = @slice'; req.input('slice', sql.NVarChar(100), opts.slice); }
    if (opts.recordType) { q += ' AND record_type = @rt'; req.input('rt', sql.NVarChar(50), opts.recordType); }
    const r = await req.query(q);
    return r.recordset.map((row: { payload: string }) => JSON.parse(row.payload) as T);
  }
}
