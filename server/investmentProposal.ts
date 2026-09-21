import { Router } from 'express';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { getPool } from './db.js';
import { askClaudeJson } from './anthropic.js';
import { getCompanyById } from './companies.js';
import { sanitizeFileBase } from './util.js';
import { buildProposalDocx, ProposalData } from './proposalDocx.js';
import { saveToSharePoint, sharePointConfigured, getProposalFromSharePoint } from './sharepoint.js';
import { SIGNERS, sendForSignature, docusignConfigured } from './docusign.js';
import { recordEnvelope } from './envelopeStore.js';
import { getDraftingGuide, saveDraft, getDraft, learnFromEdit, extractDocxText } from './proposalLearning.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const { parseOffice } = require('officeparser') as { parseOffice: (input: Buffer, cfg?: any) => Promise<any> };

// Office (non-PDF) mime types we extract text from.
const OFFICE_FILETYPE: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export const investmentProposalRouter = Router();

// Draft the proposal and return it as an attachment (the client saves it to
// Files). Synchronous within the request — reliable on App Service, and fast
// enough to fit the HTTP timeout by using Sonnet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildProposalAttachment(id: string, version = 1): Promise<any> {
    const c = await getCompanyById(id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const atts: any[] = (c.attachments ?? []).filter((a: any) => a && a.data);
    const content: Anthropic.MessageParam['content'] = [];
    const CAP = 20 * 1024 * 1024;
    let used = 0;
    for (const a of atts) {
      if (used + a.data.length > CAP) continue;
      if (a.type === 'application/pdf') {
        used += a.data.length;
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name } as Anthropic.DocumentBlockParam);
      } else if (OFFICE_FILETYPE[a.type]) {
        try {
          const parsed = await parseOffice(Buffer.from(a.data, 'base64'), { fileType: OFFICE_FILETYPE[a.type] });
          const text = String(parsed.toText() ?? '').trim().slice(0, 40000);
          if (text) { used += text.length; content.push({ type: 'text', text: `--- Extracted from "${a.name}" ---\n${text}` }); }
        } catch { /* skip unreadable file */ }
      }
    }

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const fields = {
      name: c.name, description: c.description, sector: c.sector, therapeuticArea: c.therapeuticArea,
      developmentStage: c.developmentStage, nextMilestone: c.nextMilestone, fundingStage: c.fundingStage,
      askAmount: c.askAmount, valuation: c.valuation, location: c.location, website: c.website, leadContact: c.leadContact,
    };

    // Guidance accumulated from past reviewer edits (empty until the first is learned).
    const guide = await getDraftingGuide('proposal');
    const guideBlock = guide
      ? `\n\nLEARNED DRAFTING GUIDANCE — distilled from how HealthCap reviewers have edited past AI drafts before sending them for signing. Follow it closely:\n${guide}\n`
      : '';

    content.push({
      type: 'text',
      text: `You are an investment professional at HealthCap, a Nordic life-science VC, drafting an Investment Proposal for the company below, to be reviewed by the investment committee. Reproduce HealthCap's standard proposal structure exactly.${guideBlock}
Return ONLY a valid JSON object:
{
  "date": "${today}",
  "location": "country/city",
  "syndicatingInvestors": "co-investors, or TBD",
  "amountAndTerms": "the round size and terms, or TBD",
  "preMoneyValuation": "e.g. '10 MEUR', or 'TBD MEUR'",
  "postMoneyValuation": "e.g. '41 MEUR', or 'TBD MEUR'",
  "investmentHorizon": "1-3 sentences on likely exit path and timing",
  "sections": [
    { "heading": "Background", "content": "..." },
    { "heading": "Activities", "content": "..." },
    { "heading": "Market", "content": "..." },
    { "heading": "Use of Proceeds", "content": "..." },
    { "heading": "Investment Rationale", "content": "..." },
    { "heading": "Recommendation", "content": "..." }
  ]
}

Rules:
- Use EXACTLY those section headings, in that order. Optionally insert a "Products" section immediately after "Activities" only if the materials describe specific product(s)/asset(s) in depth.
- Ground every statement ONLY in the provided company data and attached documents. Do NOT invent clinical results, financials, investors, or valuations.
- Where a figure or term is not available, write "TBD" (valuations as "TBD MEUR"), matching house style.
- HARD LENGTH LIMIT: the finished Word document — title, the metadata rows, ALL sections, and the signature page — must fit within 3 pages total. Keep the combined body of all sections to at most ~750 words. Use ONE short paragraph per section (a second only when essential). Be concise and non-repetitive; favour tight, information-dense sentences over elaboration. Use "\\n" to separate paragraphs within a section's content.
- "Recommendation" should, in the standard house style, recommend that HealthCap IX conducts in-depth due diligence to evaluate the opportunity, unless the materials clearly indicate a different recommendation.

Company data (from the deal system):
${JSON.stringify(fields, null, 2)}`,
    });

    const data = await askClaudeJson<ProposalData>({ content, model: 'claude-sonnet-4-5', maxTokens: 8000 });

    const base64 = await buildProposalDocx(c.name, data);
    const bytes = Buffer.from(base64, 'base64');
    const safe = sanitizeFileBase(c.name);
    const suffix = version > 1 ? ` (v${version})` : '';
    const attachment = {
      id: `${Date.now()}-ip`,
      name: `${safe} — Investment Proposal${suffix}.docx`,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: bytes.length,
      uploadedAt: new Date().toISOString(),
      data: base64,
    };

    // Store the generated draft's text so a later human-edited version (sent for
    // signing) can be compared against it to learn drafting improvements.
    try {
      await saveDraft(id, version, 'proposal', await extractDocxText(bytes));
    } catch (e) {
      console.error('[learning] saveDraft failed:', e instanceof Error ? e.message : e);
    }

    return { attachment, companyName: c.name };
}

// POST /api/companies/:id/investment-proposal
// Drafts the proposal, returns it (the client saves it to the Files tab), and
// best-effort uploads a copy to SharePoint (Investment proposals/<company>/).
investmentProposalRouter.post('/api/companies/:id/investment-proposal', async (req, res) => {
  try {
    const version = Math.max(1, Number(req.body?.version) || 1);
    const { attachment, companyName } = await buildProposalAttachment(req.params.id, version);

    let sharePoint: { url: string } | { error: string } | null = null;
    if (sharePointConfigured()) {
      try {
        const url = await saveToSharePoint(companyName, attachment.name, attachment.data, attachment.type);
        sharePoint = { url };
      } catch (e) {
        console.error('[investment-proposal] SharePoint upload failed:', e instanceof Error ? e.message : e);
        sharePoint = { error: e instanceof Error ? e.message : 'SharePoint upload failed' };
      }
    }

    res.json({ attachment, sharePoint });
  } catch (err) {
    console.error('[investment-proposal]', err);
    res.status(500).json({ error: 'Failed to generate investment proposal', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/companies/:id/investment-proposal/send-for-signing
// Body: { signerEmails: string[] } — must be exactly two, both on the allowlist.
// Fetches the company's proposal from SharePoint and sends a DocuSign envelope.
investmentProposalRouter.post('/api/companies/:id/investment-proposal/send-for-signing', async (req, res) => {
  try {
    if (!docusignConfigured()) {
      return res.status(400).json({ error: 'DocuSign is not configured yet. Ask an admin to set the integration key and private key.' });
    }
    if (!sharePointConfigured()) {
      return res.status(400).json({ error: 'SharePoint is not configured, so there is no signed source document to send.' });
    }

    const emails: string[] = Array.isArray(req.body?.signerEmails) ? req.body.signerEmails : [];
    const unique = [...new Set(emails.map((e) => String(e).toLowerCase()))];
    if (unique.length !== 2) {
      return res.status(400).json({ error: 'Select exactly two signers.' });
    }
    const signers = unique.map((email) => SIGNERS.find((s) => s.email.toLowerCase() === email));
    if (signers.some((s) => !s)) {
      return res.status(400).json({ error: 'One or more selected signers are not on the allowlist.' });
    }

    // Resolve the company name to locate its SharePoint subfolder.
    const pool = await getPool();
    const r = await pool.request().input('id', req.params.id).query('SELECT name FROM companies WHERE id = @id');
    const companyName: string | undefined = r.recordset[0]?.name;
    if (!companyName) return res.status(404).json({ error: 'Company not found.' });

    const proposal = await getProposalFromSharePoint(companyName);
    if (!proposal) {
      return res.status(400).json({ error: 'No investment proposal was found in SharePoint for this company. Generate one first.' });
    }

    const { envelopeId, tabDiagnostics } = await sendForSignature({
      documentBase64: proposal.base64,
      documentName: proposal.name,
      emailSubject: `Investment Proposal for signature – ${companyName}`,
      signers: signers as { name: string; email: string }[],
    });

    // Map the envelope to this company so the completion webhook can save the
    // signed PDF back to the same SharePoint folder.
    try { await recordEnvelope(envelopeId, req.params.id, companyName, 'proposal'); }
    catch (e) { console.error('[signing] recordEnvelope failed:', e instanceof Error ? e.message : e); }

    // Learn from any human edits: compare the AI draft to this finalized version.
    // Best-effort and synchronous (App Service kills post-response work); never
    // let it affect the signing result. The version is parsed from the filename.
    try {
      const ver = Number(proposal.name.match(/\(v(\d+)\)/i)?.[1] ?? 1);
      const generatedText = await getDraft(req.params.id, ver, 'proposal');
      if (generatedText) {
        const finalText = await extractDocxText(Buffer.from(proposal.base64, 'base64'));
        await learnFromEdit('proposal', { companyName, generatedText, finalText });
      }
    } catch (e) {
      console.error('[learning] learnFromEdit failed:', e instanceof Error ? e.message : e);
    }

    res.json({ envelopeId, signers: signers.map((s) => s!.name), document: proposal.name, tabDiagnostics });
  } catch (err) {
    console.error('[send-for-signing]', err);
    res.status(500).json({ error: 'Failed to send for signing', detail: err instanceof Error ? err.message : String(err) });
  }
});
