// Academic connector: concept-anchored OpenAlex (Parkinson's concept AND
// cell-therapy terms, recent) → top authors resolved to ORCID / OpenAlex id.
// Emits KOL records for the loader.
import { getJson } from '../http.js';

export interface KolRecord {
  name: string;
  openAlexId: string;
  orcid: string | null;
  institution: string | null;
  country: string | null;
  recentWorks: number;
}

export async function collectAcademics(diseaseName = "Parkinson's disease", top = 12): Promise<KolRecord[]> {
  const c = await getJson(`https://api.openalex.org/concepts?search=${encodeURIComponent(diseaseName)}&per_page=1`);
  const cid = String(c.results?.[0]?.id ?? '').split('/').pop();
  if (!cid) return [];
  const filter = `concepts.id:${cid},from_publication_date:2019-01-01,title_and_abstract.search:${encodeURIComponent('dopaminergic neuron transplantation OR stem cell replacement OR cell therapy')}`;
  const gr = await getJson(`https://api.openalex.org/works?filter=${filter}&group_by=authorships.author.id&per_page=200`);
  const keys = (gr.group_by ?? []).slice(0, top);
  const out: KolRecord[] = [];
  for (const k of keys) {
    try {
      const au = await getJson('https://api.openalex.org/authors/' + String(k.key).split('/').pop());
      out.push({
        name: au.display_name,
        openAlexId: String(au.id).split('/').pop(),
        orcid: au.orcid ? au.orcid.replace('https://orcid.org/', '') : null,
        institution: au.last_known_institutions?.[0]?.display_name ?? null,
        country: au.last_known_institutions?.[0]?.country_code ?? null,
        recentWorks: k.count,
      });
    } catch { /* skip an author that fails to resolve */ }
  }
  return out;
}
