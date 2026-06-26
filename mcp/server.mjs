/**
 * HealthCap Dealflow — MCP Server (plain ES Module, no TypeScript)
 * Run with: node mcp/server.mjs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import sql from 'mssql';
import { AzureCliCredential } from '@azure/identity';

// AzureCliCredential uses the token from `az login` — no browser pop-ups
const credential = new AzureCliCredential();
let pool = null;
let poolExpiresAt = 0;

async function getPool() {
  const now = Date.now();
  if (pool && now < poolExpiresAt - 5 * 60 * 1000) return pool;
  if (pool) { try { await pool.close(); } catch { } pool = null; }
  const token = await credential.getToken('https://database.windows.net/.default');
  poolExpiresAt = now + 55 * 60 * 1000;
  pool = await new sql.ConnectionPool({
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 5, min: 1, idleTimeoutMillis: 300000 },
    authentication: { type: 'azure-active-directory-access-token', options: { token: token.token } },
  }).connect();
  return pool;
}

function rowToCompany(row) {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    strategy: row.strategy ?? 'N/a',
    sector: row.sector ?? null,
    therapeuticArea: row.therapeutic_area ?? null,
    developmentStage: row.development_stage ?? null,
    nextMilestone: row.next_milestone ?? null,
    fundingStage: row.funding_stage ?? null,
    askAmount: row.ask_amount ?? null,
    valuation: row.valuation ?? null,
    owner: row.owner ?? null,
    location: row.location ?? null,
    website: row.website ?? null,
    description: row.description ?? '',
    leadContact: row.lead_contact ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    noteCount: (() => { try { return JSON.parse(row.note_entries || '[]').length; } catch { return 0; } })(),
    notes: (() => { try { return JSON.parse(row.note_entries || '[]'); } catch { return []; } })(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rejectedReason: row.rejected_reason ?? null,
  };
}

async function findCompany(nameOrId) {
  const p = await getPool();
  let result = await p.request()
    .input('id', sql.NVarChar(50), nameOrId)
    .query('SELECT * FROM companies WHERE id = @id');
  if (result.recordset.length > 0) return rowToCompany(result.recordset[0]);
  result = await p.request()
    .input('name', sql.NVarChar(200), `%${nameOrId}%`)
    .query('SELECT TOP 1 * FROM companies WHERE name LIKE @name ORDER BY created_at DESC');
  if (result.recordset.length > 0) return rowToCompany(result.recordset[0]);
  return null;
}

const server = new Server(
  { name: 'healthcap-dealflow', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_companies',
      description: 'List all companies in the dealflow database with key fields: name, stage, strategy, sector, therapeutic area, development stage, next milestone, funding stage, ask amount, valuation, owner, location, note count.',
      inputSchema: {
        type: 'object',
        properties: {
          stage:    { type: 'string', description: 'Filter by stage: new, first_meeting, due_diligence, terms_negotiation, invested, backburner, rejected' },
          strategy: { type: 'string', description: 'Filter by strategy: N/a, Biotech, Tech, Growth' },
        },
      },
    },
    {
      name: 'get_company',
      description: 'Get full details for one company including all fields and notes. Provide company name (partial match OK) or exact id.',
      inputSchema: {
        type: 'object',
        properties: {
          nameOrId: { type: 'string', description: 'Company name (partial) or exact id' },
        },
        required: ['nameOrId'],
      },
    },
    {
      name: 'update_company',
      description: 'Update fields on a company. Only provided fields are changed. Updatable: stage, strategy, sector, therapeuticArea, developmentStage, nextMilestone, fundingStage, askAmount, valuation, owner, location, website, description, leadContact, email, phone.',
      inputSchema: {
        type: 'object',
        properties: {
          nameOrId: { type: 'string', description: 'Company name (partial) or exact id' },
          fields: {
            type: 'object',
            description: 'Fields to update as key-value pairs',
            properties: {
              stage: { type: 'string' }, strategy: { type: 'string' },
              sector: { type: 'string' }, therapeuticArea: { type: 'string' },
              developmentStage: { type: 'string' }, nextMilestone: { type: 'string' },
              fundingStage: { type: 'string' }, askAmount: { type: 'string' },
              valuation: { type: 'string' }, owner: { type: 'string' },
              location: { type: 'string' }, website: { type: 'string' },
              description: { type: 'string' }, leadContact: { type: 'string' },
              email: { type: 'string' }, phone: { type: 'string' },
            },
          },
        },
        required: ['nameOrId', 'fields'],
      },
    },
    {
      name: 'add_note',
      description: "Append a note to a company's note timeline. The note appears in the Notes tab in the web app.",
      inputSchema: {
        type: 'object',
        properties: {
          nameOrId: { type: 'string', description: 'Company name (partial) or exact id' },
          text:     { type: 'string', description: 'Note text' },
          author:   { type: 'string', description: 'Author name (default: Claude)' },
        },
        required: ['nameOrId', 'text'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'list_companies') {
    const p = await getPool();
    let query = 'SELECT * FROM companies';
    const conditions = [];
    const req = p.request();
    if (args?.stage)    { conditions.push('stage = @stage');       req.input('stage',    sql.NVarChar(50), args.stage); }
    if (args?.strategy) { conditions.push('strategy = @strategy'); req.input('strategy', sql.NVarChar(50), args.strategy); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY created_at DESC';
    const result = await req.query(query);
    const companies = result.recordset.map(rowToCompany).map(c => ({
      id: c.id, name: c.name, stage: c.stage, strategy: c.strategy,
      sector: c.sector, therapeuticArea: c.therapeuticArea,
      developmentStage: c.developmentStage, nextMilestone: c.nextMilestone,
      fundingStage: c.fundingStage, askAmount: c.askAmount, valuation: c.valuation,
      owner: c.owner, location: c.location, noteCount: c.noteCount, createdAt: c.createdAt,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(companies, null, 2) }] };
  }

  if (name === 'get_company') {
    const company = await findCompany(String(args?.nameOrId ?? ''));
    if (!company) return { content: [{ type: 'text', text: `No company found matching "${args?.nameOrId}"` }] };
    return { content: [{ type: 'text', text: JSON.stringify(company, null, 2) }] };
  }

  if (name === 'update_company') {
    const company = await findCompany(String(args?.nameOrId ?? ''));
    if (!company) return { content: [{ type: 'text', text: `No company found matching "${args?.nameOrId}"` }] };
    const fields = args?.fields ?? {};
    const allowed = {
      stage: 'stage', strategy: 'strategy', sector: 'sector',
      therapeuticArea: 'therapeutic_area', developmentStage: 'development_stage',
      nextMilestone: 'next_milestone', fundingStage: 'funding_stage',
      askAmount: 'ask_amount', valuation: 'valuation', owner: 'owner',
      location: 'location', website: 'website', description: 'description',
      leadContact: 'lead_contact', email: 'email', phone: 'phone',
    };
    const sets = ['updated_at = @updated_at'];
    const p = await getPool();
    const req = p.request()
      .input('id', sql.NVarChar(50), company.id)
      .input('updated_at', sql.NVarChar(30), new Date().toISOString());
    for (const [key, col] of Object.entries(allowed)) {
      if (key in fields) {
        sets.push(`${col} = @${key}`);
        req.input(key, sql.NVarChar(sql.MAX), fields[key] ?? null);
      }
    }
    await req.query(`UPDATE companies SET ${sets.join(', ')} WHERE id = @id`);
    return { content: [{ type: 'text', text: `Updated ${company.name} — changed: ${Object.keys(fields).join(', ')}` }] };
  }

  if (name === 'add_note') {
    const company = await findCompany(String(args?.nameOrId ?? ''));
    if (!company) return { content: [{ type: 'text', text: `No company found matching "${args?.nameOrId}"` }] };
    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: String(args?.text ?? ''),
      createdAt: new Date().toISOString(),
      createdBy: String(args?.author ?? 'Claude'),
    };
    const updatedNotes = [...company.notes, note];
    const p = await getPool();
    await p.request()
      .input('id', sql.NVarChar(50), company.id)
      .input('note_entries', sql.NVarChar(sql.MAX), JSON.stringify(updatedNotes))
      .input('updated_at', sql.NVarChar(30), new Date().toISOString())
      .query('UPDATE companies SET note_entries = @note_entries, updated_at = @updated_at WHERE id = @id');
    return { content: [{ type: 'text', text: `Note added to ${company.name}` }] };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('HealthCap Dealflow MCP server running');
}

main().catch(console.error);
