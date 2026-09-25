// Container Apps Job entrypoint: drain the graph_jobs queue, running collection
// for each pending company, then exit. Bounded by MAX_JOBS per run.
import { openSql } from './db.js';
import { claimNext, complete, fail } from './jobs.js';
import { runCollectionForCompany } from './collect.js';

const MAX = Number(process.env.MAX_JOBS || '25');

const pool = await openSql();
let done = 0, failed = 0, processed = 0;
try {
  for (let i = 0; i < MAX; i++) {
    const id = await claimNext(pool);
    if (!id) break;
    processed++;
    try {
      const s = await runCollectionForCompany(id);
      await complete(pool, id);
      done++;
      console.log(`[worker] done ${id}`, JSON.stringify({ company: s.company, slice: s.slice, programs: s.programs, kols: s.kols }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await fail(pool, id, msg);
      failed++;
      console.error(`[worker] failed ${id}: ${msg}`);
    }
  }
} finally {
  await pool.close();
}
console.log(`[worker] finished: processed=${processed} done=${done} failed=${failed}`);
