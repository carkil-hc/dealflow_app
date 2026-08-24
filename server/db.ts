import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';
import 'dotenv/config';

const credential = new DefaultAzureCredential();

async function getAccessToken(): Promise<string> {
  const token = await credential.getToken('https://database.windows.net/.default');
  return token.token;
}

let pool: sql.ConnectionPool | null = null;
let poolExpiresAt = 0;

// Rebuild the pool 5 minutes before the token expires (tokens last ~1 hour)
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getPool(): Promise<sql.ConnectionPool> {
  const now = Date.now();
  if (pool && now < poolExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return pool;
  }

  // Close old pool if it exists
  if (pool) {
    try { await pool.close(); } catch { /* ignore */ }
    pool = null;
  }

  const token = await getAccessToken();

  // Azure AD tokens expire in 3600 seconds by default
  poolExpiresAt = now + 55 * 60 * 1000;

  const config: sql.config = {
    server: process.env.AZURE_SQL_SERVER!,
    database: process.env.AZURE_SQL_DATABASE!,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    // A serverless Azure SQL database can be paused and takes ~30-60s to resume.
    // Wait for the resume instead of failing at the 15s default.
    connectionTimeout: 60000,
    requestTimeout: 60000,
    pool: {
      max: 10,
      min: 1,
      idleTimeoutMillis: 600000,
    },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token },
    },
  };

  // Retry the initial connect a few times — the first attempts while a paused
  // serverless DB is still resuming can bounce before it accepts connections.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      pool = await new sql.ConnectionPool(config).connect();
      return pool;
    } catch (err) {
      lastErr = err;
      pool = null;
      poolExpiresAt = 0;
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}
