// Academic connector: concept-anchored OpenAlex (Parkinson's concept AND
// cell-therapy terms, recent), ranked by LEADERSHIP authorship. Authors are
// scored by how often they are first/last author on the matched works (the
// senior/lead signal), not by raw co-authorship count — this demotes
// middle-author ride-alongs from large consortia and lifts the real KOLs.
// ORCID + institution come from the authorship records (no per-author calls).
import { getJson } from '../http.js';

export interface KolRecord {
  name: string;
  openAlexId: string;
  orcid: string | null;
  institution: string | null;
  country: string | null;
  recentWorks: number;   // total matched works the author appears on
  leadWorks: number;     // matched works where they are first or last author
}

interface Agg { name: string; orcid: string | null; total: number; lead: number; insts: Map<string, number>; country: string | null; }

// Cell-therapy / regeneration primary topics (chosen from the primary-topic
// distribution of PD cell-therapy works). Anchoring on these AND the disease
// concept keeps clinical/translational cell-therapy work and drops off-topic
// papers (e.g. computational basal-ganglia modelling) that merely mention the terms.
const CELL_THERAPY_TOPICS = [
  'T10505', // Pluripotent Stem Cells Research
  'T10483', // Nerve injury and regeneration
  'T10176', // Mesenchymal stem cell research
];

export async function collectAcademics(diseaseName = "Parkinson's disease", opts: { cellTherapy?: boolean; top?: number } = {}): Promise<KolRecord[]> {
  const top = opts.top ?? 12;
  const c = await getJson(`https://api.openalex.org/concepts?search=${encodeURIComponent(diseaseName)}&per_page=1`);
  const cid = String(c.results?.[0]?.id ?? '').split('/').pop();
  if (!cid) return [];
  // Cell-therapy companies: anchor on cell-therapy primary topics for precision.
  // Other modalities: concept + leadership ranking only (no cell-topic filter).
  const topicClause = opts.cellTherapy ? `,primary_topic.id:${CELL_THERAPY_TOPICS.join('|')}` : '';
  const filter = `concepts.id:${cid}${topicClause},from_publication_date:2019-01-01`;

  const authors = new Map<string, Agg>();
  let cursor = '*'; let pages = 0;
  do {
    const d = await getJson(`https://api.openalex.org/works?filter=${filter}&per_page=200&sort=cited_by_count:desc&cursor=${encodeURIComponent(cursor)}`);
    for (const w of (d.results ?? [])) {
      for (const a of (w.authorships ?? [])) {
        const id = a.author?.id; if (!id) continue;
        let e = authors.get(id);
        if (!e) { e = { name: a.author.display_name, orcid: a.author.orcid ? a.author.orcid.replace('https://orcid.org/', '') : null, total: 0, lead: 0, insts: new Map(), country: null }; authors.set(id, e); }
        e.total++;
        if (a.author_position === 'first' || a.author_position === 'last') e.lead++;
        for (const inst of (a.institutions ?? [])) {
          if (inst.display_name) e.insts.set(inst.display_name, (e.insts.get(inst.display_name) ?? 0) + 1);
          if (!e.country && inst.country_code) e.country = inst.country_code;
        }
      }
    }
    cursor = d.meta?.next_cursor; pages++;
  } while (cursor && pages < 3);

  return [...authors.entries()]
    .map(([id, e]) => ({ id, e, score: e.lead * 3 + e.total }))
    .filter(x => x.e.lead > 0)                       // must have led at least one matched work
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
    .map(({ id, e }) => ({
      name: e.name,
      openAlexId: String(id).split('/').pop()!,
      orcid: e.orcid,
      institution: [...e.insts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      country: e.country,
      recentWorks: e.total,
      leadWorks: e.lead,
    }));
}
