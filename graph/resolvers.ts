// Canonical-ID resolvers. Each maps a raw string (+ optional context) to a
// canonical identifier so the same real-world entity becomes one graph node.
// Contract: return a Resolution; a null canonicalId (or low confidence) means the
// caller should QUARANTINE rather than write a guessed node.
//
// Open data only: Open Targets (disease/target/drug), OpenAlex (person),
// deterministic normalisation (company).

export interface Resolution {
  canonicalId: string | null;   // e.g. "MONDO_0005180", "CHEMBL25", "ORCID:0000-...", "company:bluerock-therapeutics"
  label?: string;               // human name of the resolved entity
  scheme?: string;              // mondo | efo | ensembl | hgnc | chembl | orcid | openalex | normalised
  confidence: number;           // 0..1
  source: string;
  note?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function getJson(url: string, opts?: RequestInit): Promise<any> {
  let last = '';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, opts);
    if (r.ok) return r.json();
    last = `${r.status}`;
    if (r.status === 503 || r.status === 429) { await sleep(3000); continue; }
    throw new Error(`${url.slice(0, 60)} ${last}`);
  }
  throw new Error(`${url.slice(0, 60)} ${last}`);
}

// ── Open Targets search (disease / target / drug) ──
const OT = 'https://api.platform.opentargets.org/api/v4/graphql';
async function otSearch(q: string, entity: 'disease' | 'target' | 'drug') {
  const query = `query($q:String!,$e:[String!]){ search(queryString:$q, entityNames:$e){ hits{ id name entity object{ __typename ... on Target{approvedSymbol} } } } }`;
  const d = await getJson(OT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { q, e: [entity] } }) });
  const hits = (d.data?.search?.hits ?? []).filter((h: any) => h.entity === entity);
  return hits[0] ?? null;
}
function conf(query: string, name?: string): number {
  if (!name) return 0.6;
  const a = query.trim().toLowerCase(), b = name.trim().toLowerCase();
  return a === b ? 1 : b.includes(a) || a.includes(b) ? 0.85 : 0.6;
}

export async function resolveDisease(name: string): Promise<Resolution> {
  const h = await otSearch(name, 'disease');
  if (!h) return { canonicalId: null, confidence: 0, source: 'OpenTargets', note: 'no disease match' };
  return { canonicalId: h.id, label: h.name, scheme: h.id.startsWith('MONDO') ? 'mondo' : 'efo', confidence: conf(name, h.name), source: 'OpenTargets' };
}

export async function resolveTarget(symbolOrName: string): Promise<Resolution> {
  const h = await otSearch(symbolOrName, 'target');
  if (!h) return { canonicalId: null, confidence: 0, source: 'OpenTargets', note: 'no target match' };
  return { canonicalId: h.id, label: h.object?.approvedSymbol ?? h.name, scheme: 'ensembl', confidence: conf(symbolOrName, h.object?.approvedSymbol ?? h.name), source: 'OpenTargets' };
}

export async function resolveDrug(name: string): Promise<Resolution> {
  const h = await otSearch(name, 'drug');
  if (!h) return { canonicalId: null, confidence: 0, source: 'OpenTargets', note: 'not in ChEMBL — quarantine (e.g. cell/biologic therapy)' };
  return { canonicalId: h.id, label: h.name, scheme: 'chembl', confidence: conf(name, h.name), source: 'OpenTargets' };
}

// ── Company: deterministic normalisation + alias crosswalk ──
// Strips legal-entity suffixes and parentheticals only (not industry descriptors,
// which would risk false merges). Known variants can be pinned in ALIASES.
const LEGAL = /\b(inc|incorporated|ltd|limited|llc|l\.l\.c|corp|corporation|co|company|gmbh|ag|ab|oyj|oy|asa|as|sas|sa|s\.a|nv|n\.v|bv|b\.v|plc|kk|kabushiki|aps|a\/s|pte|spa|srl)\b/gi;
const ALIASES: Record<string, string> = {
  // normalised -> canonical (pin only where the heuristic would split a real dup)
  'xellsmart-bio-pharmaceutical': 'xellsmart',
};
export function resolveCompany(raw: string): Resolution {
  if (!raw || !raw.trim()) return { canonicalId: null, confidence: 0, source: 'normalise', note: 'empty' };
  let s = raw.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[.,]/g, ' ');
  s = s.replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const key = ALIASES[s] ?? s;
  return { canonicalId: 'company:' + key, label: raw.trim(), scheme: 'normalised', confidence: 1, source: 'normalise' };
}

// ── Person: OpenAlex author search + context disambiguation ──
export async function resolvePerson(name: string, ctx?: { institution?: string; country?: string }): Promise<Resolution> {
  const d = await getJson(`https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per_page=5`);
  const cands: any[] = d.results ?? [];
  if (!cands.length) return { canonicalId: null, confidence: 0, source: 'OpenAlex', note: 'no author match' };
  const score = (a: any) => {
    let s = Math.min(a.works_count ?? 0, 200) / 400; // mild popularity prior
    const insts = (a.last_known_institutions ?? a.affiliations?.map((x: any) => x.institution) ?? []).filter(Boolean);
    if (ctx?.institution && insts.some((i: any) => (i.display_name ?? '').toLowerCase().includes(ctx.institution!.toLowerCase()))) s += 2;
    if (ctx?.country && insts.some((i: any) => i.country_code === ctx.country)) s += 1;
    return s;
  };
  const best = [...cands].sort((a, b) => score(b) - score(a))[0];
  const orcid = best.orcid ? best.orcid.replace('https://orcid.org/', '') : null;
  const oaId = String(best.id).split('/').pop();
  const nameMatch = conf(name, best.display_name);
  return {
    canonicalId: orcid ? `ORCID:${orcid}` : `OPENALEX:${oaId}`,
    label: best.display_name,
    scheme: orcid ? 'orcid' : 'openalex',
    confidence: Math.min(1, nameMatch * 0.6 + (score(best) >= 1 ? 0.4 : 0.1)),
    source: 'OpenAlex',
  };
}
