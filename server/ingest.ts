import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getPool } from './db.js';
import { anthropic } from './anthropic.js';
import { upsertOne } from './companies.js';

// Derive a display name from a healthcap.eu sender address.
// "carl.kilander@healthcap.eu"  →  "Carl"
// Falls back to 'Inbound' for any other format.
export function ownerFromSender(from: string | undefined): string {
  if (!from) return 'Inbound';
  const match = from.match(/([a-zA-Z0-9._%+-]+)@healthcap\.eu/i);
  if (!match) return 'Inbound';
  const firstName = match[1].split('.')[0];
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaRaw = Record<string, any>;
const getBytes = (a: PaRaw): string => a['contentBytes'] ?? a['ContentBytes'] ?? '';
const getAttName = (a: PaRaw): string => a['name'] ?? a['Name'] ?? '';
// PDF magic bytes: "%PDF" → base64 prefix "JVBER"
const isPdf = (data: string) => typeof data === 'string' && data.trimStart().startsWith('JVBER');

// The actual processing logic — runs after the HTTP response is already sent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processIngest(payload: Record<string, any>): Promise<void> {
  const { subject, body, from } = payload;

  const rawAtts: PaRaw[] = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (rawAtts.length === 0 && payload.attachment) {
    rawAtts.push({ contentBytes: payload.attachment, name: payload.attachmentName ?? '' });
  }

  rawAtts.forEach((a, i) => {
    const bytes = getBytes(a);
    console.log(`[ingest] att[${i}] name="${getAttName(a)}" magic="${bytes.slice(0, 6)}" len=${bytes.length}`);
  });

  const pdfAtt = rawAtts.find(a => isPdf(getBytes(a))) ?? null;
  const hasPdf = pdfAtt !== null;
  const pdfBytes = hasPdf ? getBytes(pdfAtt!) : '';
  const pdfName  = hasPdf ? getAttName(pdfAtt!) : '';

  console.log(`[ingest] subject="${subject}" from="${from}" totalAtts=${rawAtts.length} pdfFound=${hasPdf} pdfName="${pdfName}"`);

  const content: Anthropic.MessageParam['content'] = [];
  if (hasPdf) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdfBytes },
    } as Anthropic.DocumentBlockParam);
  }

  const noDocNote = !hasPdf && rawAtts.length > 0
    ? `\nNote: ${rawAtts.length} attachment(s) received but none are valid PDFs (magic: ${rawAtts.map(a => getBytes(a).slice(0, 6)).join(', ')}). Extract from email text only.`
    : '';

  content.push({
    type: 'text',
    text: `You are processing an inbound pitch deck for a healthcare/life science VC firm.\n\nEmail subject: ${subject ?? ''}\nEmail body: ${body ?? ''}\nSender: ${from ?? ''}${noDocNote}\n\nRead the pitch deck carefully and extract company information. Return ONLY a valid JSON object with these exact fields (use null for anything you cannot determine):\n\n{"name":"Company legal or trade name","description":"2-3 sentence summary of what the company does and its key value proposition","website":"URL if present, else null","sector":"exactly one of: Pharmaceutical, Medtech, Healthtech, Tool, Other","location":"country name only","therapeuticArea":"the primary disease area or therapeutic indication (e.g. Oncology, CNS, Cardiology, Rare Disease, Immunology, Infectious Disease, etc.) — look for disease names, indications, and patient populations throughout the deck","developmentStage":"exactly one of: Preclinical, IND-stage, Phase I, Phase II, Phase III, Marketed — look for pipeline tables, clinical section headings, and regulatory status","nextMilestone":"the single most important upcoming milestone (e.g. IND filing, Phase I start, Phase II data readout, regulatory approval) — look for roadmap/timeline slides","fundingStage":"exactly one of: Seed, Series A, Series B, Series C+, IPO, Public — or null","askAmount":"the amount they are raising in this round, as a string (e.g. €10M, $15M) — or null","valuation":"pre-money or post-money valuation if stated — or null","leadContact":"full name of main contact person","email":"contact email address","phone":"contact phone number"}`,
  });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const textBlock = message.content.find(c => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text from Claude');

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in Claude response. Raw: ${textBlock.text.slice(0, 300)}`);
  const extracted = JSON.parse(jsonMatch[0]);

  const now = new Date().toISOString();

  const attachments: Array<{ id: string; name: string; type: string; size: number; uploadedAt: string; data?: string }> = [];
  if (hasPdf) {
    const buf = Buffer.from(pdfBytes, 'base64');
    const fileName = pdfName.trim()
      || (subject?.trim() ? `${subject.trim().replace(/[^a-z0-9 _-]/gi, '_')}.pdf` : 'pitch-deck.pdf');
    attachments.push({
      id: `${Date.now()}-att`,
      name: fileName,
      type: 'application/pdf',
      size: buf.length,
      uploadedAt: now,
      data: pdfBytes,
    });
  }

  const straightToReject = typeof body === 'string' && /straight to reject/i.test(body);
  const company = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    stage: straightToReject ? 'rejected' : 'new',
    strategy: 'N/a',
    owner: ownerFromSender(from),
    ...(straightToReject ? { rejectedReason: 'Straight to reject', rejectedAt: now } : {}),
    noteEntries: [],
    attachments,
    history: [{ id: `${Date.now()}-h`, type: 'created', timestamp: now, user: 'Power Automate' }],
    createdAt: now,
    updatedAt: now,
    ...extracted,
  };

  const pool = await getPool();
  await upsertOne(pool, company);
  console.log(`[ingest] saved company "${company.name}" id=${company.id} pdfAttached=${attachments.length > 0}`);
}

export const ingestRouter = Router();

// POST /api/ingest-pitch-deck — called by Power Automate with email + attachment.
// Responds immediately (so Power Automate never times out) then processes in the background.
ingestRouter.post('/api/ingest-pitch-deck', (req, res) => {
  const apiKey = process.env.INGEST_API_KEY;
  if (apiKey && req.headers['x-api-key'] !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Acknowledge immediately — Claude + DB work happens in the background
  res.json({ ok: true, status: 'processing' });

  processIngest(req.body).catch(err => {
    console.error('[ingest] background processing failed:', err instanceof Error ? err.message : err);
  });
});
