// Financings & strategic-deals connector (open data: SEC EDGAR).
//  - Financings: Form D private-placement filings (with offering amount).
//  - Deals: 8-K material events matching deal keywords (best-effort).
// Coverage skews US-registered filers; ex-US / private companies are thin — a
// licensed feed (Cortellis/PitchBook/BioCentury) slots in behind this same
// interface. SEC requires a declared User-Agent with a contact.
import { getJson } from '../http.js';

const EDGAR_UA = 'HealthCap Dealflow Graph dealflow@healthcap.eu';
const HDRS = { 'User-Agent': EDGAR_UA };

export interface FinancingRecord { id: string; company: string; date: string; roundType: string; amountUsd: number | null; url: string; }
export interface DealRecord { id: string; company: string; date: string; dealType: string; url: string; }

// Normalise an entity name for comparison: drop parentheticals (the "(CIK …)"
// suffix EDGAR appends), legal suffixes, and punctuation.
const LEGAL = /\b(inc|incorporated|ltd|limited|llc|corp|corporation|co|company|gmbh|ag|ab|plc|lp|holdings?)\b/gi;
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[.,]/g, ' ').replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// The issuer of a filing is its first display name. Keep a hit only when the
// ISSUER *is* the company — equal, or the company as a leading prefix — so
// investor SPVs like "Gaingels <Company> LLC" (issuer = Gaingels) are excluded.
function issuerIsCompany(hit: any, companyNorm: string): boolean {
  const issuer = norm(String((hit._source?.display_names ?? [])[0] ?? ''));
  return issuer === companyNorm || issuer.startsWith(companyNorm + ' ');
}

async function fts(name: string, forms: string, q = ''): Promise<any[]> {
  const query = q ? `%22${encodeURIComponent(name)}%22 ${encodeURIComponent(q)}` : `%22${encodeURIComponent(name)}%22`;
  const url = `https://efts.sec.gov/LATEST/search-index?q=${query}&forms=${forms}&startdt=2019-01-01&enddt=2026-12-31`;
  const d = await getJson(url, { headers: HDRS });
  const companyNorm = norm(name);
  if (!companyNorm) return [];
  return (d.hits?.hits ?? []).filter((h: any) => issuerIsCompany(h, companyNorm));
}

const accOf = (id: string) => String(id).split(':')[0];

async function formDAmount(cik: string, accession: string): Promise<number | null> {
  try {
    const acc = accession.replace(/-/g, '');
    const r = await fetch(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/primary_doc.xml`, { headers: HDRS });
    if (!r.ok) return null;
    const xml = await r.text();
    const sold = xml.match(/<totalAmountSold>(\d+)<\/totalAmountSold>/)?.[1];
    const off = xml.match(/<totalOfferingAmount>(\d+)<\/totalOfferingAmount>/)?.[1];
    return sold ? Number(sold) : off ? Number(off) : null;
  } catch { return null; }
}

export async function collectFinancings(companyName: string, cap = 8): Promise<FinancingRecord[]> {
  const hits = (await fts(companyName, 'D')).slice(0, cap);
  const out: FinancingRecord[] = [];
  for (const h of hits) {
    const acc = accOf(h._id);
    const cik = String(h._source?.ciks?.[0] ?? '');
    out.push({
      id: 'formd:' + acc,
      company: companyName,
      date: h._source?.file_date ?? '',
      roundType: 'Form D (private placement)',
      amountUsd: cik ? await formDAmount(cik, acc) : null,
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&type=D&dateb=&owner=include&count=40&search_text=`,
    });
  }
  return out;
}

const DEAL_Q = 'license OR collaboration OR acquisition OR merger';
export async function collectDeals(companyName: string, cap = 5): Promise<DealRecord[]> {
  const hits = (await fts(companyName, '8-K', DEAL_Q)).slice(0, cap);
  return hits.map((h: any) => ({
    id: '8k:' + accOf(h._id),
    company: companyName,
    date: h._source?.file_date ?? '',
    dealType: 'SEC 8-K material event (license/collaboration/M&A)',
    url: 'https://www.sec.gov/Archives/edgar/data/' + String(h._source?.ciks?.[0] ?? '').replace(/^0+/, '') + '/',
  }));
}
