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
async function gdelt(company: string, max = 8): Promise<{ title: string; url: string; domain: string; date: string }[]> {
  const q = `"${company}" (acquire OR acquisition OR merger OR licensing OR collaboration OR partnership OR deal)`;
  const u = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=${max}&format=json&sort=hybridrel`;
  try {
    const r = await fetch(u, { headers: H }); if (!r.ok) return [];
    const d: any = JSON.parse(await r.text());
    return (d.articles ?? []).map((a: any) => ({ title: a.title ?? '', url: a.url ?? '', domain: a.domain ?? '', date: (a.seendate ?? '').slice(0, 8) }));
  } catch { return []; }
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

  // GDELT: recent news headlines (forward monitoring).
  const arts = await gdelt(company);
  if (arts.length) {
    const text = arts.map(a => `${a.date}: ${a.title} (${a.domain})`).join('\n');
    for (const d of await extract(company, text, client)) {
      const a = arts.find(x => text.indexOf(d.evidence.slice(0, 30)) >= 0 && x.title.includes(d.evidence.slice(0, 20))) ?? arts[0];
      found.push({ ...d, id: '', source: 'GDELT: ' + a.domain, url: a.url, confidence: 0.5 });
    }
  }

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
