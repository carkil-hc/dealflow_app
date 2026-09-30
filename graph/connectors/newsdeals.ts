// News / encyclopedic deals connector: captures acquisitions, licensing and
// collaborations that SEC EDGAR can't (private targets, foreign acquirers) by
// reading Wikipedia (authoritative/historical) and GDELT (free news index, for
// recent deals), then extracting structured deals with Claude — each grounded in
// a verbatim quote so nothing is invented. Trust tier is 'inferred'; a licensed
// feed slots in behind the same NewsDeal shape.
import Anthropic from '@anthropic-ai/sdk';

const H = { 'User-Agent': 'HealthCap Dealflow Graph dealflow@healthcap.eu', 'Accept': 'application/json' };

export type DealType = 'acquisition' | 'licensing' | 'collaboration' | 'jv' | 'financing' | 'other';
export type Role = 'target' | 'acquirer' | 'licensor' | 'licensee' | 'partner' | 'investor' | 'party';

export interface NewsDeal {
  id: string;
  company: string;            // the competitor we queried (one party)
  companyRole: Role;
  counterparty: string | null;
  counterpartyRole: Role;
  dealType: DealType;
  value: string | null;       // as reported, e.g. "$600 million"
  date: string | null;        // 'YYYY' | 'YYYY-MM'
  source: string;             // 'Wikipedia: <title>' | 'GDELT: <domain>'
  url: string;
  evidence: string;           // verbatim quote grounding the extraction
  confidence: number;
}

const slug = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// Normalise a party name for dedup so "Bayer" and "Bayer AG" collapse to one key.
const LEGAL = /\b(inc|incorporated|ltd|limited|llc|corp|corporation|co|company|gmbh|ag|sa|plc|nv|bv|ab|oyj|oy|kk|aps|as|asa|pte|spa|srl)\b/gi;
const partyKey = (s: string | null) => (s || 'na').toLowerCase().replace(/\./g, ' ').replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'na';
const distinctive = (name: string) => name.replace(/\b(inc|ltd|llc|corp|co|gmbh|ag|therapeutics|biosciences|pharmaceuticals?|bio|pharma|sa|plc)\b\.?/gi, ' ').replace(/[^a-z0-9 ]/gi, ' ').trim().split(/\s+/)[0] || name;

// ── Wikipedia ──
async function wikiSearch(q: string, limit = 3): Promise<string[]> {
  const u = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${limit}&format=json`;
  const d: any = await (await fetch(u, { headers: H })).json();
  return (d.query?.search ?? []).map((s: any) => s.title);
}
async function wikiExtract(title: string): Promise<string> {
  const u = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}&format=json`;
  const d: any = await (await fetch(u, { headers: H })).json();
  const p: any = Object.values(d.query?.pages ?? {})[0];
  return p?.extract ?? '';
}
// Windows of text around each mention of the company, to keep the prompt focused
// and ensure the grounding quote is present.
function snippets(text: string, token: string, win = 320, max = 5): string {
  const out: string[] = []; const low = text.toLowerCase(); const t = token.toLowerCase();
  let i = low.indexOf(t);
  while (i >= 0 && out.length < max) {
    out.push(text.slice(Math.max(0, i - win), i + win).replace(/\s+/g, ' ').trim());
    i = low.indexOf(t, i + win);
  }
  return out.join('\n…\n');
}

// ── GDELT (free global news index; recency-oriented → forward monitoring) ──
// Biotech trade press — the best discovery starting point for deals. GDELT indexes
// their public articles; we restrict to these domains and read headlines (which in
// trade press usually carry the deal + amount), keeping the URL to click through.
// The core English biotech deal outlets. Kept small: GDELT returns nothing for
// queries with too many OR-clauses, so a lean domain list is more reliable.
const TRADE_DOMAINS = ['fiercebiotech.com', 'fiercepharma.com', 'endpts.com', 'biospace.com', 'biopharmadive.com'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let lastGdelt = 0;
// GDELT allows one request / 5s and rate-limits hard; serialise, space calls, and
// retry on a 429 or a transient network error / non-JSON body.
async function gdeltGet(u: string): Promise<any | null> {
  for (let i = 0; i < 4; i++) {
    const wait = 6000 - (Date.now() - lastGdelt); if (wait > 0) await sleep(wait);
    lastGdelt = Date.now();
    try {
      const r = await fetch(u, { headers: H });
      const t = await r.text();
      if (r.ok && t.startsWith('{')) return JSON.parse(t);
      // 429 / "Please limit requests…" / transient — back off and retry.
    } catch { /* network hiccup — retry */ }
    await sleep(2000);
  }
  return null;
}
interface Article { title: string; url: string; domain: string; date: string }
function articles(d: any): Article[] {
  return (d?.articles ?? []).map((a: any) => ({ title: a.title ?? '', url: a.url ?? '', domain: a.domain ?? '', date: (a.seendate ?? '').slice(0, 8) }));
}

// ── Claude extraction (grounded) ──
const VALID_TYPES: DealType[] = ['acquisition', 'licensing', 'collaboration', 'jv', 'financing', 'other'];
const VALID_ROLES: Role[] = ['target', 'acquirer', 'licensor', 'licensee', 'partner', 'investor', 'party'];

async function extract(company: string, text: string, client: Anthropic): Promise<Omit<NewsDeal, 'id' | 'source' | 'url' | 'confidence'>[]> {
  if (!text.trim()) return [];
  const prompt = `Extract corporate deals in which the company "${company}" is itself a direct party — acquisitions, licensing, collaborations, joint ventures or financings. Ignore deals between other companies that merely appear in the text.

Return ONLY a JSON array. Each item:
{"counterparty": the other party's name (string) or null,
 "companyRole": one of ${JSON.stringify(VALID_ROLES)} — ${company}'s role,
 "counterpartyRole": one of ${JSON.stringify(VALID_ROLES)} — the other party's role,
 "dealType": one of ${JSON.stringify(VALID_TYPES)},
 "value": the deal value exactly as reported (e.g. "$600 million", "up to $1.2B") or null,
 "date": "YYYY" or "YYYY-MM" or null,
 "evidence": an EXACT verbatim quote (<=200 chars) copied from the text that states this deal and names ${company}}

Rules: every item MUST include an evidence quote copied verbatim from the text. If you cannot find such a quote, omit the item. If there are no deals, return [].

TEXT:
${text.slice(0, 9000)}`;
  const msg = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
  const raw = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  const m = raw.match(/\[[\s\S]*\]/); if (!m) return [];
  let arr: any[]; try { arr = JSON.parse(m[0]); } catch { return []; }
  const lowText = text.toLowerCase();
  const out: Omit<NewsDeal, 'id' | 'source' | 'url' | 'confidence'>[] = [];
  for (const d of Array.isArray(arr) ? arr : []) {
    const ev = String(d.evidence ?? '');
    // Grounding: the quote must actually appear in the source text.
    if (!ev || !lowText.includes(ev.toLowerCase().slice(0, 60))) continue;
    out.push({
      company,
      companyRole: VALID_ROLES.includes(d.companyRole) ? d.companyRole : 'party',
      counterparty: d.counterparty ? String(d.counterparty) : null,
      counterpartyRole: VALID_ROLES.includes(d.counterpartyRole) ? d.counterpartyRole : 'party',
      dealType: VALID_TYPES.includes(d.dealType) ? d.dealType : 'other',
      value: d.value ? String(d.value) : null,
      date: d.date ? String(d.date) : null,
      evidence: ev.slice(0, 200),
    });
  }
  return out;
}

// ── Orchestration ──
export async function collectNewsDeals(company: string, opts: { top?: number } = {}): Promise<NewsDeal[]> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return [];
  const client = new Anthropic({ apiKey: key });
  const token = distinctive(company);
  const found: NewsDeal[] = [];

  // Wikipedia: the company's own page + pages that surface it (acquirer, founder).
  const titles = [...new Set([company, ...await wikiSearch(company, opts.top ?? 3)])].slice(0, (opts.top ?? 3) + 1);
  for (const title of titles) {
    const text = await wikiExtract(title);
    const snip = snippets(text, token);
    if (!snip) continue;
    for (const d of await extract(company, snip, client)) {
      found.push({ ...d, id: '', source: 'Wikipedia: ' + title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')), confidence: d.value && d.date ? 0.8 : 0.65 });
    }
  }

  // (Trade-press/news discovery runs once per slice — see collectTradePressDeals —
  // rather than per company, so the rate-limited GDELT API isn't hit 8× a run.)

  // Dedupe + corroborate: same (counterparty, type, year) collapses; more distinct
  // sources → higher confidence; keep the richest evidence.
  const byKey = new Map<string, NewsDeal>();
  for (const d of found) {
    const year = (d.date ?? '').slice(0, 4);
    const key = `${partyKey(d.counterparty)}|${d.dealType}|${year}`;
    d.id = `deal:${slug(company)}:${key}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, d); continue; }
    prev.confidence = Math.min(0.98, prev.confidence + 0.15);           // corroborated
    if ((d.value && !prev.value) || d.evidence.length > prev.evidence.length) { prev.value ??= d.value; prev.evidence = d.evidence; prev.source += '; ' + d.source; }
  }
  return [...byKey.values()];
}

// ── Trade-press deal sweep (slice-level discovery) ──
// One GDELT query over biotech trade press for the slice's topic + deal keywords.
// Trade press is the discovery starting point: it names deals (often with amounts)
// for companies that may not be in the clinical-trial set at all.
export async function extractHeadlines(text: string, topic: string, client: Anthropic): Promise<{ company: string; counterparty: string | null; companyRole: Role; counterpartyRole: Role; dealType: DealType; value: string | null; date: string | null; evidence: string }[]> {
  if (!text.trim()) return [];
  const prompt = `Each line below is a biotech trade-press headline about "${topic}", formatted "DATE: HEADLINE — domain <url>". Extract the corporate deals (acquisitions, licensing, collaborations, financings) they report.

Return ONLY a JSON array; each item:
{"company": the primary company the deal is about (string),
 "counterparty": the other party or null,
 "companyRole": one of ${JSON.stringify(VALID_ROLES)},
 "counterpartyRole": one of ${JSON.stringify(VALID_ROLES)},
 "dealType": one of ${JSON.stringify(VALID_TYPES)},
 "value": deal value exactly as written (e.g. "$48M") or null,
 "date": "YYYY-MM-DD" or "YYYY" or null,
 "evidence": the headline text copied verbatim}

Only include a headline that clearly states a deal. Every item MUST have an evidence quote copied verbatim from a headline. If none, return [].

HEADLINES:
${text.slice(0, 9000)}`;
  const msg = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] });
  const raw = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  const m = raw.match(/\[[\s\S]*\]/); if (!m) return [];
  let arr: any[]; try { arr = JSON.parse(m[0]); } catch { return []; }
  const low = text.toLowerCase();
  const out: any[] = [];
  for (const d of Array.isArray(arr) ? arr : []) {
    const ev = String(d.evidence ?? '');
    if (!ev || !d.company || !low.includes(ev.toLowerCase().slice(0, 40))) continue; // grounding
    out.push({
      company: String(d.company),
      counterparty: d.counterparty ? String(d.counterparty) : null,
      companyRole: VALID_ROLES.includes(d.companyRole) ? d.companyRole : 'party',
      counterpartyRole: VALID_ROLES.includes(d.counterpartyRole) ? d.counterpartyRole : 'party',
      dealType: VALID_TYPES.includes(d.dealType) ? d.dealType : 'other',
      value: d.value ? String(d.value) : null,
      date: d.date ? String(d.date) : null,
      evidence: ev.slice(0, 200),
    });
  }
  return out;
}

export async function collectTradePressDeals(topicTerms: string[], opts: { timespan?: string; max?: number } = {}): Promise<NewsDeal[]> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return [];
  const client = new Anthropic({ apiKey: key });
  const domains = TRADE_DOMAINS.map(d => `domainis:${d}`).join(' OR ');
  const topic = topicTerms.filter(Boolean).map(t => `"${t}"`).join(' OR ');
  const deal = '(acquisition OR acquires OR licensing OR collaboration OR partnership OR merger)';
  const q = `(${domains}) (${topic}) ${deal}`;
  const u = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=${opts.max ?? 25}&format=json&sort=datedesc&timespan=${opts.timespan ?? '12m'}`;
  const arts = articles(await gdeltGet(u));
  if (!arts.length) return [];
  const text = arts.map(a => `${a.date}: ${a.title} — ${a.domain} <${a.url}>`).join('\n');
  const found: NewsDeal[] = [];
  for (const d of await extractHeadlines(text, topicTerms[0] ?? 'biotech', client)) {
    const a = arts.find(x => x.title && d.evidence.toLowerCase().includes(x.title.toLowerCase().slice(0, 30))) ?? arts.find(x => x.title.toLowerCase().includes(d.evidence.toLowerCase().slice(0, 30)));
    const year = (d.date ?? '').slice(0, 4);
    found.push({
      ...d,
      id: `deal:${slug(d.company)}:${partyKey(d.counterparty)}|${d.dealType}|${year}`,
      source: 'Trade press' + (a ? ': ' + a.domain : ''),
      url: a?.url ?? 'https://www.gdeltproject.org',
      confidence: d.value ? 0.6 : 0.5,
    });
  }
  return found;
}
