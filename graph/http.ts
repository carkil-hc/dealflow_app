// Shared fetch with retry/backoff for the open APIs (they 503/429 under load).
// A descriptive User-Agent is required — the APIs (Cloudflare-fronted) 403 the
// default Node UA from datacenter IPs.
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = 'HealthCap-Dealflow-Graph/1.0 (+https://dealflow.healthcap.eu)';

export async function getJson(url: string, opts: RequestInit = {}): Promise<any> {
  let last = '';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, 'Accept': 'application/json', ...(opts.headers ?? {}) } });
    if (r.ok) return r.json();
    last = `${r.status} ${(await r.text()).slice(0, 120)}`;
    if (r.status === 503 || r.status === 429) { await sleep(3000); continue; }
    throw new Error(`${url.slice(0, 70)} ${last}`);
  }
  throw new Error(`${url.slice(0, 70)} ${last}`);
}
