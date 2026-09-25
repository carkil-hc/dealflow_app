// Shared Azure SQL connection (AAD token — managed identity in the container,
// az login locally). Used by staging, the company reader, and the job queue.
import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

const cred = new DefaultAzureCredential();

export async function openSql(): Promise<sql.ConnectionPool> {
  const server = process.env.AZURE_SQL_SERVER, database = process.env.AZURE_SQL_DATABASE;
  if (!server || !database) throw new Error('AZURE_SQL_SERVER / AZURE_SQL_DATABASE not set');
  const token = (await cred.getToken('https://database.windows.net/.default')).token;
  return new sql.ConnectionPool({
    server, database,
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 60000, requestTimeout: 60000,
    authentication: { type: 'azure-active-directory-access-token', options: { token } },
  }).connect();
}

export { sql };
