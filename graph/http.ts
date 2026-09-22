// Shared fetch with retry/backoff for the open APIs (they 503/429 under load).
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function getJson(url: string, opts?: RequestInit): Promise<any> {
  let last = '';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, opts);
    if (r.ok) return r.json();
    last = `${r.status} ${(await r.text()).slice(0, 120)}`;
    if (r.status === 503 || r.status === 429) { await sleep(3000); continue; }
    throw new Error(`${url.slice(0, 70)} ${last}`);
  }
  throw new Error(`${url.slice(0, 70)} ${last}`);
}
