import { Router } from 'express';
import { getDraftingGuide, seedGuideFromExamples, resetGuide, extractText, DocType } from './proposalLearning.js';

export const draftingGuideRouter = Router();

function parseDocType(v: unknown): DocType | null {
  return v === 'proposal' || v === 'recommendation' ? v : null;
}

// GET current guide text for a doc type.
draftingGuideRouter.get('/api/drafting-guide/:type', async (req, res) => {
  const dt = parseDocType(req.params.type);
  if (!dt) return res.status(400).json({ error: 'Unknown document type.' });
  res.json({ guide: await getDraftingGuide(dt) });
});

// POST past documents (base64 files) to seed/augment a guide from exemplars.
draftingGuideRouter.post('/api/drafting-guide/:type/seed', async (req, res) => {
  const dt = parseDocType(req.params.type);
  if (!dt) return res.status(400).json({ error: 'Unknown document type.' });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const files: any[] = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0) return res.status(400).json({ error: 'No files provided.' });
    const examples: { name: string; text: string }[] = [];
    for (const f of files) {
      try {
        const text = await extractText(String(f.name ?? dt), String(f.data ?? ''));
        if (text) examples.push({ name: String(f.name ?? dt), text });
      } catch { /* skip unreadable file */ }
    }
    if (examples.length === 0) return res.status(400).json({ error: 'Could not read text from the uploaded files.' });
    await seedGuideFromExamples(dt, examples);
    res.json({ ok: true, learnedFrom: examples.map((e) => e.name), guide: await getDraftingGuide(dt) });
  } catch (err) {
    console.error('[drafting-guide/seed]', err);
    res.status(500).json({ error: 'Failed to seed the drafting guide', detail: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE a guide (start over).
draftingGuideRouter.delete('/api/drafting-guide/:type', async (req, res) => {
  const dt = parseDocType(req.params.type);
  if (!dt) return res.status(400).json({ error: 'Unknown document type.' });
  await resetGuide(dt);
  res.json({ ok: true });
});
