// Collection profile: the editable "instruction" that steers intelligence
// collection for a company. The app shows an auto-generated proposal (disease /
// target / mechanism / modality / stage, from the company record via Claude) that
// the user can correct and save; the graph worker reads the saved profile and uses
// it as the collection seed + extra steering. Stored as JSON in graph_steering.
import { Router } from 'express';
import sql from 'mssql';
import { getPool } from './db.js';
import { getCompanyById } from './companies.js';
import { askClaudeJson } from './anthropic.js';

const MODALITIES = ['cell therapy', 'small molecule', 'biologic/mAb', 'gene therapy', 'other'];

export interface CollectionProfile {
  diseaseName: string;
  target: string | null;
  mechanism: string | null;
  modality: string;
  maxStage: string | null;
  notes: string; // free-text steering: narrow scope, name a technology/target, exclusions
}

// Generate a proposed profile from the company record (same anchors the worker's
// seed extraction uses). Used only when the user hasn't saved one yet.
export async function generateProfile(company: { name: string; therapeuticArea?: string; description?: string }): Promise<CollectionProfile> {
  const fallback: CollectionProfile = { diseaseName: company.therapeuticArea || company.name, target: null, mechanism: null, modality: 'other', maxStage: null, notes: '' };
  try {
    const j = await askClaudeJson<Record<string, unknown>>({
      maxTokens: 320,
      content: `From this biotech company, return ONLY a JSON object describing its lead program's competitive anchors. Use null for anything not confidently known — do not guess.
{"diseaseName": the single primary disease/indication, specific,
 "target": the primary molecular drug target as a gene symbol or protein (e.g. "5-HT2A", "FcγRIIB", "TYK2"), or null,
 "mechanism": the mechanism of action, short phrase, or null,
 "modality": one of ${JSON.stringify(MODALITIES)},
 "maxStage": most advanced stage, one of "Preclinical"|"Phase 1"|"Phase 2"|"Phase 3"|"Approved", or null}

Name: ${company.name}
Therapeutic area: ${company.therapeuticArea ?? ''}
Description: ${company.description ?? ''}`,
    });
    const str = (v: unknown) => (v == null || v === '' || v === 'null' ? null : String(v));
    return {
      diseaseName: String(j.diseaseName || fallback.diseaseName),
      target: str(j.target),
      mechanism: str(j.mechanism),
      modality: MODALITIES.includes(String(j.modality)) ? String(j.modality) : 'other',
      maxStage: str(j.maxStage),
      notes: '',
    };
  } catch { return fallback; }
}

function sanitize(p: Record<string, unknown>): CollectionProfile {
  const str = (v: unknown, max = 400) => (v == null ? null : String(v).slice(0, max));
  return {
    diseaseName: String(p.diseaseName ?? '').slice(0, 300),
    target: str(p.target),
    mechanism: str(p.mechanism),
    modality: MODALITIES.includes(String(p.modality)) ? String(p.modality) : 'other',
    maxStage: str(p.maxStage, 40),
    notes: String(p.notes ?? '').slice(0, 4000),
  };
}

export const collectionProfileRouter = Router();

// GET — the saved profile, or a generated proposal if none saved yet.
collectionProfileRouter.get('/api/companies/:id/collection-profile', async (req, res) => {
  try {
    const pool = await getPool();
    const row = await pool.request().input('id', sql.NVarChar(100), req.params.id).query('SELECT steering, updated_at FROM graph_steering WHERE company_id=@id');
    if (row.recordset.length) {
      res.json({ source: 'saved', updatedAt: row.recordset[0].updated_at, profile: JSON.parse(row.recordset[0].steering) });
      return;
    }
    const company = await getCompanyById(req.params.id);
    res.json({ source: 'generated', profile: await generateProfile(company) });
  } catch (err) {
    console.error('[collection-profile GET]', err);
    res.status(500).json({ error: 'Failed to load collection profile', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST — save the (edited) profile.
collectionProfileRouter.post('/api/companies/:id/collection-profile', async (req, res) => {
  try {
    const profile = sanitize(req.body?.profile ?? req.body ?? {});
    if (!profile.diseaseName.trim()) return res.status(400).json({ error: 'diseaseName is required' });
    const pool = await getPool();
    const now = new Date().toISOString();
    await pool.request()
      .input('id', sql.NVarChar(100), req.params.id)
      .input('steering', sql.NVarChar(sql.MAX), JSON.stringify(profile))
      .input('now', sql.NVarChar(30), now)
      .query(`MERGE graph_steering AS t USING (SELECT @id AS company_id) AS s ON t.company_id = s.company_id
        WHEN MATCHED THEN UPDATE SET steering=@steering, updated_at=@now
        WHEN NOT MATCHED THEN INSERT (company_id, steering, updated_at) VALUES (@id, @steering, @now);`);
    res.json({ ok: true, profile });
  } catch (err) {
    console.error('[collection-profile POST]', err);
    res.status(500).json({ error: 'Failed to save collection profile', detail: err instanceof Error ? err.message : String(err) });
  }
});
