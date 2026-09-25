// Ops helper: enqueue a collection job for a company id. Usage: npx tsx enqueue.ts <companyId>
import { openSql } from './db.js';
import { enqueue } from './jobs.js';

const id = process.argv[2];
if (!id) { console.error('usage: npx tsx enqueue.ts <companyId>'); process.exit(1); }
const pool = await openSql();
await enqueue(pool, id);
await pool.close();
console.log('enqueued', id);
