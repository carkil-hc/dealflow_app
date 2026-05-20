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
    pool: {
      max: 10,
      min: 2,
      idleTimeoutMillis: 600000,
    },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token },
    },
  };

  pool = await new sql.ConnectionPool(config).connect();
  return pool;
}
