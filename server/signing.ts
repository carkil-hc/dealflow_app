import express, { Router } from 'express';
import { sanitizeFileBase } from './util.js';
import { saveToSharePoint, sharePointConfigured } from './sharepoint.js';
import { SIGNERS, docusignConfigured, docusignHealth, downloadCombinedPdf, getEnvelopeStatus } from './docusign.js';
import { getEnvelope, markEnvelopeSaved, getPendingEnvelopes, getAllPendingEnvelopes, PendingEnvelope } from './envelopeStore.js';
import { generateBoardApprovals } from './boardApproval.js';

export const signingRouter = Router();

const SIGNED_LABEL: Record<'proposal' | 'recommendation' | 'board-approval', string> = {
  proposal: 'Investment Proposal',
  recommendation: 'Investment Recommendation',
  'board-approval': 'Board Approvals',
};

// For each envelope, if completed, download the signed PDF and save it to the
// company's SharePoint folder. When a recommendation completes, also auto-generate
// the two board-approval protocols. Returns saved filenames + still-pending count.
async function saveCompletedEnvelopes(envs: PendingEnvelope[]): Promise<{ saved: string[]; pending: number }> {
  const saved: string[] = [];
  let pending = 0;
  for (const env of envs) {
    try {
      if (await getEnvelopeStatus(env.envelopeId) !== 'completed') { pending++; continue; }
      const pdf = await downloadCombinedPdf(env.envelopeId);
      const safe = sanitizeFileBase(env.companyName);
      const fileName = `${safe} — ${SIGNED_LABEL[env.docType]} (Signed).pdf`;
      await saveToSharePoint(env.companyName, fileName, pdf, 'application/pdf');
      await markEnvelopeSaved(env.envelopeId);
      saved.push(fileName);
      if (env.docType === 'recommendation') {
        try { await generateBoardApprovals(env.companyId, env.companyName); }
        catch (e) { console.error('[board-approvals] auto-generate failed:', e instanceof Error ? e.message : e); }
      }
    } catch (e) {
      console.error('[signed-sync] envelope', env.envelopeId, 'failed:', e instanceof Error ? e.message : e);
      pending++;
    }
  }
  return { saved, pending };
}

// GET /api/docusign/health — diagnostic: confirms JWT auth works (no envelope).
signingRouter.get('/api/docusign/health', async (_req, res) => {
  res.json(await docusignHealth());
});

// GET /api/signers — the server-authoritative signer allowlist for the dropdown.
signingRouter.get('/api/signers', (_req, res) => {
  res.json({ signers: SIGNERS });
});

// POST /api/companies/:id/sync-signed — pull this company's completed envelopes.
signingRouter.post('/api/companies/:id/sync-signed', async (req, res) => {
  try {
    if (!docusignConfigured() || !sharePointConfigured()) return res.json({ saved: [], pending: 0 });
    res.json(await saveCompletedEnvelopes(await getPendingEnvelopes(req.params.id)));
  } catch (err) {
    console.error('[sync-signed]', err);
    res.status(500).json({ error: 'Failed to sync signed copies', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/signed-sweep — pull completed envelopes across ALL companies. Runs on
// app load (and can be called by a scheduler) so signed copies land in SharePoint
// without anyone opening the specific company.
signingRouter.post('/api/signed-sweep', async (_req, res) => {
  try {
    if (!docusignConfigured() || !sharePointConfigured()) return res.json({ saved: [], pending: 0 });
    res.json(await saveCompletedEnvelopes(await getAllPendingEnvelopes(50)));
  } catch (err) {
    console.error('[signed-sweep]', err);
    res.status(500).json({ error: 'Failed to sweep signed copies', detail: err instanceof Error ? err.message : String(err) });
  }
});

// Pull the envelope id + completed status out of a DocuSign Connect payload,
// tolerating both the JSON (aani) and legacy XML formats.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEnvelope(body: any): { envelopeId?: string; completed: boolean } {
  if (body && typeof body === 'object') {
    const envelopeId = body.data?.envelopeId ?? body.envelopeId ?? body.data?.envelopeSummary?.envelopeId;
    const status = String(body.event ?? body.data?.envelopeSummary?.status ?? body.status ?? '').toLowerCase();
    return { envelopeId, completed: status.includes('completed') };
  }
  const s = String(body ?? '');
  const m = s.match(/<EnvelopeID>([^<]+)<\/EnvelopeID>/i) ?? s.match(/"envelopeId"\s*:\s*"([^"]+)"/i);
  const completed = /<Status>\s*Completed\s*<\/Status>/i.test(s) || /"status"\s*:\s*"completed"/i.test(s) || /envelope-completed/i.test(s);
  return { envelopeId: m?.[1], completed };
}

// POST /api/docusign/connect — DocuSign completion webhook. When an envelope is
// completed, download the signed combined PDF and save it to the same SharePoint
// company folder as the draft. Protected by a shared-secret token.
signingRouter.post('/api/docusign/connect', express.text({ type: '*/*', limit: '30mb' }), async (req, res) => {
  const secret = process.env.DOCUSIGN_CONNECT_SECRET;
  if (secret && req.query.token !== secret) { res.status(401).end(); return; }
  try {
    const { envelopeId, completed } = extractEnvelope(req.body);
    if (!envelopeId || !completed) { res.status(200).end(); return; }
    const map = await getEnvelope(envelopeId);
    if (!map) { res.status(200).end(); return; }        // not one of ours
    if (map.savedAt) { res.status(200).end(); return; }  // already saved
    if (!sharePointConfigured()) { res.status(200).end(); return; }

    const pdf = await downloadCombinedPdf(envelopeId);
    const safe = sanitizeFileBase(map.companyName);
    await saveToSharePoint(map.companyName, `${safe} — ${SIGNED_LABEL[map.docType]} (Signed).pdf`, pdf, 'application/pdf');
    await markEnvelopeSaved(envelopeId);
    console.log(`[docusign-connect] saved signed PDF for envelope ${envelopeId} (${map.companyName})`);
    if (map.docType === 'recommendation') {
      try { await generateBoardApprovals(map.companyId, map.companyName); }
      catch (e) { console.error('[board-approvals] auto-generate (webhook) failed:', e instanceof Error ? e.message : e); }
    }
    res.status(200).end();
  } catch (err) {
    // Non-200 → DocuSign retries later (requireAcknowledgment is on).
    console.error('[docusign-connect] failed:', err instanceof Error ? err.message : err);
    res.status(500).end();
  }
});
