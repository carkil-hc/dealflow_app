import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';
import 'dotenv/config';

const credential = new DefaultAzureCredential();

async function getAccessToken(): Promise<string> {
  const token = await credential.getToken('https://database.windows.net/.default');
  return token.token;
}

async function buildConfig(): Promise<sql.config> {
  const token = await getAccessToken();
  return {
    server: process.env.AZURE_SQL_SERVER!,
    database: process.env.AZURE_SQL_DATABASE!,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token },
    },
  };
}

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    const config = await buildConfig();
    pool = await new sql.ConnectionPool(config).connect();
  }
  return pool;
}
