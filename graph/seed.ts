// Seed extraction: derive the company's competitive anchors from its dealflow
// record (via Claude) so collection can run on any company. The anchors define
// the relevance chain used to rank competitors: disease > target > mechanism >
// modality. Falls back to the therapeutic-area field if the model/key is absent.
import Anthropic from '@anthropic-ai/sdk';
import type { CompanyRow } from './companies.js';

export type Modality = 'cell therapy' | 'small molecule' | 'biologic/mAb' | 'gene therapy' | 'other';
export interface Seed {
  diseaseName: string;
  target: string | null;      // primary drug target — gene symbol / protein (e.g. "5-HT2A", "GLP-1R"), or null
  mechanism: string | null;   // mechanism of action, short phrase (e.g. "5-HT2A receptor agonist")
  modality: Modality;
  maxStage: string | null;    // the company's most advanced stage: Preclinical | Phase 1 | Phase 2 | Phase 3 | Approved
}

const MODALITIES = ['cell therapy', 'small molecule', 'biologic/mAb', 'gene therapy', 'other'];

export async function extractSeed(c: CompanyRow): Promise<Seed> {
  const fallback: Seed = { diseaseName: c.therapeuticArea || c.name, target: null, mechanism: null, modality: 'other', maxStage: null };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback;
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 320,
      messages: [{ role: 'user', content: `From this biotech company, return ONLY a JSON object describing its lead program's competitive anchors. Use null for anything not stated or not confidently known — do not guess.
{"diseaseName": the single primary disease/indication, specific (e.g. "Parkinson's disease", "major depressive disorder"),
 "target": the primary molecular drug target as a gene symbol or protein name (e.g. "5-HT2A", "GLP-1R", "TYK2"), or null,
 "mechanism": the mechanism of action as a short phrase (e.g. "5-HT2A receptor agonist", "TYK2 inhibitor"), or null,
 "modality": one of ${JSON.stringify(MODALITIES)},
 "maxStage": the most advanced development stage, one of "Preclinical" | "Phase 1" | "Phase 2" | "Phase 3" | "Approved", or null}

Name: ${c.name}
Therapeutic area: ${c.therapeuticArea ?? ''}
Description: ${c.description ?? ''}` }],
    });
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const j = JSON.parse(m[0]);
    const str = (v: unknown) => (v == null || v === '' || v === 'null' ? null : String(v));
    return {
      diseaseName: String(j.diseaseName || fallback.diseaseName),
      target: str(j.target),
      mechanism: str(j.mechanism),
      modality: (MODALITIES.includes(j.modality) ? j.modality : 'other') as Modality,
      maxStage: str(j.maxStage),
    };
  } catch {
    return fallback;
  }
}
