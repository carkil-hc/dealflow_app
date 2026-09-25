// CLI: run collection for one company by id (default = JZ Cell Tech).
//   $env:GRAPH_KEY=...; $env:AZURE_SQL_SERVER=...; $env:AZURE_SQL_DATABASE=...; $env:ANTHROPIC_API_KEY=...
//   npx tsx load.ts [companyId]     # fetch + stage + load
//   $env:REPROCESS='1'  npx tsx load.ts [companyId]   # rebuild from staging only
//   $env:RESET_KOLS='1' npx tsx load.ts [companyId]   # clear the slice's KOLs first
import { runCollectionForCompany } from './collect.js';

const companyId = process.argv[2] || '1787147325475-h602xqpsg4e'; // JZ Cell Tech
runCollectionForCompany(companyId, { reprocess: !!process.env.REPROCESS, resetKols: !!process.env.RESET_KOLS })
  .then(s => console.log(JSON.stringify(s, null, 2)))
  .catch(e => { console.error('LOAD ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
