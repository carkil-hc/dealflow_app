// Seed extraction: derive the primary disease + modality for a company from its
// dealflow record (via Claude), so collection can run on any company. Falls back
// to the therapeutic-area field if the model/ key is unavailable.
import Anthropic from '@anthropic-ai/sdk';
import type { CompanyRow } from './companies.js';

export type Modality = 'cell therapy' | 'small molecule' | 'biologic/mAb' | 'gene therapy' | 'other';
export interface Seed { diseaseName: string; modality: Modality; }

export async function extractSeed(c: CompanyRow): Promise<Seed> {
  const key = process.env.ANTHROPIC_API_KEY;
  const fallback: Seed = { diseaseName: c.therapeuticArea || c.name, modality: 'other' };
  if (!key) return fallback;
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 200,
      messages: [{ role: 'user', content: `From this biotech company, return ONLY a JSON object:\n{"diseaseName": the single primary disease or indication, specific (e.g. "Parkinson's disease", "systemic lupus erythematosus"), "modality": one of "cell therapy" | "small molecule" | "biologic/mAb" | "gene therapy" | "other"}\n\nName: ${c.name}\nTherapeutic area: ${c.therapeuticArea ?? ''}\nDescription: ${c.description ?? ''}` }],
    });
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const j = JSON.parse(m[0]);
    return {
      diseaseName: String(j.diseaseName || fallback.diseaseName),
      modality: (['cell therapy', 'small molecule', 'biologic/mAb', 'gene therapy', 'other'].includes(j.modality) ? j.modality : 'other') as Modality,
    };
  } catch {
    return fallback;
  }
}
