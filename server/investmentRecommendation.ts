import { Router } from 'express';
import sql from 'mssql';
import { getPool } from './db.js';
import { askClaudeJson } from './anthropic.js';
import { rowToCompany } from './companies.js';
import { buildProposalDocx, ProposalData } from './investmentProposal.js';
import { saveToSharePoint, sharePointConfigured, getProposalFromSharePoint } from './sharepoint.js';
import { SIGNERS, sendForSignature, docusignConfigured } from './docusign.js';
import { getDraftingGuide, saveDraft, getDraft, learnFromEdit, extractDocxText } from './proposalLearning.js';

export const investmentRecommendationRouter = Router();

const REC_TITLE = 'Investment Recommendation – HealthCap IX D AB and HealthCap IX E AB';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// The four deal-term fields the user verifies before generating.
interface VerifiedTerms {
  syndicate: string;
  amountAndTerms: string;
  preMoneyValuation: string;
  postMoneyValuation: string;
}

function readVerified(body: unknown): VerifiedTerms {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (body as any)?.verified ?? {};
  return {
    syndicate: String(v.syndicate ?? '').trim(),
    amountAndTerms: String(v.amountAndTerms ?? '').trim(),
    preMoneyValuation: String(v.preMoneyValuation ?? '').trim(),
    postMoneyValuation: String(v.postMoneyValuation ?? '').trim(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCompany(id: string): Promise<any> {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.NVarChar(50), id).query('SELECT * FROM companies WHERE id = @id');
  if (result.recordset.length === 0) throw new Error('Company not found');
  return rowToCompany(result.recordset[0]);
}

// The Investment Proposal is the recommendation's primary source. Prefer the
// SharePoint copy; fall back to a proposal .docx in the company's attachments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function latestProposalText(companyName: string, company: any): Promise<string> {
  try {
    if (sharePointConfigured()) {
      const p = await getProposalFromSharePoint(companyName, 'proposal');
      if (p) return await extractDocxText(Buffer.from(p.base64, 'base64'));
    }
  } catch { /* fall through to attachments */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const att = (company.attachments ?? []).find((a: any) => a?.data && /Investment Proposal.*\.docx$/i.test(a.name));
  if (att) { try { return await extractDocxText(Buffer.from(att.data, 'base64')); } catch { /* ignore */ } }
  return '';
}

// ── Prefill: suggest the four verify-fields from the proposal + record ────────
investmentRecommendationRouter.post('/api/companies/:id/recommendation/prefill', async (req, res) => {
  try {
    const c = await loadCompany(req.params.id);
    const proposalText = await latestProposalText(c.name, c);
    const fields = {
      name: c.name, sector: c.sector, therapeuticArea: c.therapeuticArea,
      fundingStage: c.fundingStage, askAmount: c.askAmount, valuation: c.valuation,
    };
    const content = `From the HealthCap Investment Proposal and company data below, extract the four deal-term fields for an Investment Recommendation. Use exact figures where present; where a value is not available write "TBD". Return ONLY a JSON object:
{
  "syndicate": "co-investors in the round, or TBD",
  "amountAndTerms": "round name + total amount + material terms (tranches/warrants), or TBD",
  "preMoneyValuation": "e.g. '135 MSEK', or 'TBD'",
  "postMoneyValuation": "e.g. '508.5 MSEK', or 'TBD'"
}

Company data:
${JSON.stringify(fields, null, 2)}

=== INVESTMENT PROPOSAL (primary source) ===
${proposalText ? proposalText.slice(0, 30000) : '(no proposal found — infer from company data or use TBD)'}`;

    const data = await askClaudeJson<VerifiedTerms>({ content, model: 'claude-sonnet-4-5', maxTokens: 1200 });
    res.json({
      verified: {
        syndicate: data.syndicate ?? 'TBD',
        amountAndTerms: data.amountAndTerms ?? 'TBD',
        preMoneyValuation: data.preMoneyValuation ?? 'TBD',
        postMoneyValuation: data.postMoneyValuation ?? 'TBD',
      },
      hasProposal: !!proposalText,
    });
  } catch (err) {
    console.error('[recommendation/prefill]', err);
    res.status(500).json({ error: 'Failed to prepare the recommendation', detail: err instanceof Error ? err.message : String(err) });
  }
});

// ── Build the recommendation .docx ───────────────────────────────────────────
interface RecData {
  location: string;
  companyInception: string;
  investmentHorizon: string;
  sections: { heading: string; content: string }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildRecommendationAttachment(id: string, version: number, verified: VerifiedTerms): Promise<any> {
  const c = await loadCompany(id);
  const proposalText = await latestProposalText(c.name, c);
  const guide = await getDraftingGuide('recommendation');
  const guideBlock = guide
    ? `\n\nLEARNED DRAFTING GUIDANCE — distilled from finalized HealthCap recommendations and reviewer edits. Follow it closely:\n${guide}\n`
    : '';
  const today = new Date().toISOString().slice(0, 10);
  const fields = {
    name: c.name, description: c.description, sector: c.sector, therapeuticArea: c.therapeuticArea,
    developmentStage: c.developmentStage, nextMilestone: c.nextMilestone, location: c.location, website: c.website,
  };

  const content = `You are an investment professional at HealthCap, a Nordic life-science VC, drafting the final Investment Recommendation (the board-approval document) for the company below. Reproduce HealthCap's standard recommendation structure exactly.${guideBlock}
The following deal terms have been VERIFIED by the investment team and MUST be used verbatim — do NOT restate or alter them in your output (they are added separately):
- Syndicate: ${verified.syndicate}
- Amount and Terms: ${verified.amountAndTerms}
- Pre-money Valuation: ${verified.preMoneyValuation}
- Post-money Valuation: ${verified.postMoneyValuation}

Return ONLY a valid JSON object:
{
  "location": "country/city",
  "companyInception": "year the company was founded, or ''",
  "investmentHorizon": "1-3 sentences on the likely exit route and timing",
  "sections": [
    { "heading": "Background", "content": "..." },
    { "heading": "Products", "content": "..." },
    { "heading": "Activities", "content": "..." },
    { "heading": "Market", "content": "..." },
    { "heading": "Use of Proceeds", "content": "..." },
    { "heading": "Investment Rationale", "content": "..." },
    { "heading": "Recommendation", "content": "..." }
  ]
}

Rules:
- Use EXACTLY those section headings, in that order.
- Ground every statement ONLY in the provided Investment Proposal and company data. Do NOT invent clinical results, financials, investors, or valuations.
- The "Recommendation" section MUST be decisive in the house style: "It is recommended that HealthCap IX D AB and HealthCap IX E AB collectively invest [amount] in the [round] of ${c.name}." Reflect the verified Amount and Terms (including tranches if stated), and note that investment documentation is prepared by the company's legal counsel (amendment agreements to the SHA and IA) where appropriate.
- Match a concise, formal style; each section 1-3 short paragraphs. Use "\\n" to separate paragraphs within a section.

Company data (from the deal system):
${JSON.stringify(fields, null, 2)}

=== INVESTMENT PROPOSAL (primary source) ===
${proposalText ? proposalText.slice(0, 40000) : '(no proposal found — draft from company data)'}`;

  const rec = await askClaudeJson<RecData>({ content, model: 'claude-sonnet-4-5', maxTokens: 8000 });

  const data: ProposalData = {
    date: today,
    location: rec.location,
    companyInception: rec.companyInception || undefined,
    syndicatingInvestors: verified.syndicate,
    amountAndTerms: verified.amountAndTerms,
    preMoneyValuation: verified.preMoneyValuation,
    postMoneyValuation: verified.postMoneyValuation,
    investmentHorizon: rec.investmentHorizon,
    sections: rec.sections,
  };

  const base64 = await buildProposalDocx(c.name, data, { title: REC_TITLE, syndicateLabel: 'Syndicate' });
  const bytes = Buffer.from(base64, 'base64');
  const safe = c.name.replace(/[^a-z0-9 _-]/gi, '_');
  const suffix = version > 1 ? ` (v${version})` : '';
  const attachment = {
    id: `${Date.now()}-ir`,
    name: `${safe} — Investment Recommendation${suffix}.docx`,
    type: DOCX_TYPE,
    size: bytes.length,
    uploadedAt: new Date().toISOString(),
    data: base64,
  };

  try {
    await saveDraft(id, version, 'recommendation', await extractDocxText(bytes));
  } catch (e) {
    console.error('[learning] saveDraft (recommendation) failed:', e instanceof Error ? e.message : e);
  }

  return { attachment, companyName: c.name };
}

// ── Generate ─────────────────────────────────────────────────────────────────
investmentRecommendationRouter.post('/api/companies/:id/investment-recommendation', async (req, res) => {
  try {
    const version = Math.max(1, Number(req.body?.version) || 1);
    const verified = readVerified(req.body);
    if (!verified.syndicate || !verified.amountAndTerms || !verified.preMoneyValuation || !verified.postMoneyValuation) {
      return res.status(400).json({ error: 'All four verified fields (Syndicate, Amount and Terms, Pre-money, Post-money) are required.' });
    }
    const { attachment, companyName } = await buildRecommendationAttachment(req.params.id, version, verified);

    let sharePoint: { url: string } | { error: string } | null = null;
    if (sharePointConfigured()) {
      try {
        const url = await saveToSharePoint(companyName, attachment.name, attachment.data, attachment.type);
        sharePoint = { url };
      } catch (e) {
        console.error('[investment-recommendation] SharePoint upload failed:', e instanceof Error ? e.message : e);
        sharePoint = { error: e instanceof Error ? e.message : 'SharePoint upload failed' };
      }
    }
    res.json({ attachment, sharePoint });
  } catch (err) {
    console.error('[investment-recommendation]', err);
    res.status(500).json({ error: 'Failed to generate investment recommendation', detail: err instanceof Error ? err.message : String(err) });
  }
});

// ── Send for signing ─────────────────────────────────────────────────────────
investmentRecommendationRouter.post('/api/companies/:id/investment-recommendation/send-for-signing', async (req, res) => {
  try {
    if (!docusignConfigured()) return res.status(400).json({ error: 'DocuSign is not configured yet.' });
    if (!sharePointConfigured()) return res.status(400).json({ error: 'SharePoint is not configured, so there is no signed source document to send.' });

    const emails: string[] = Array.isArray(req.body?.signerEmails) ? req.body.signerEmails : [];
    const unique = [...new Set(emails.map((e) => String(e).toLowerCase()))];
    if (unique.length !== 2) return res.status(400).json({ error: 'Select exactly two signers.' });
    const signers = unique.map((email) => SIGNERS.find((s) => s.email.toLowerCase() === email));
    if (signers.some((s) => !s)) return res.status(400).json({ error: 'One or more selected signers are not on the allowlist.' });

    const pool = await getPool();
    const r = await pool.request().input('id', req.params.id).query('SELECT name FROM companies WHERE id = @id');
    const companyName: string | undefined = r.recordset[0]?.name;
    if (!companyName) return res.status(404).json({ error: 'Company not found.' });

    const doc = await getProposalFromSharePoint(companyName, 'recommendation');
    if (!doc) return res.status(400).json({ error: 'No investment recommendation was found in SharePoint for this company. Generate one first.' });

    const { envelopeId } = await sendForSignature({
      documentBase64: doc.base64,
      documentName: doc.name,
      emailSubject: `Investment Recommendation for signature – ${companyName}`,
      signers: signers as { name: string; email: string }[],
    });

    // Learn from human edits: compare the AI draft to this finalized version.
    try {
      const ver = Number(doc.name.match(/\(v(\d+)\)/i)?.[1] ?? 1);
      const generatedText = await getDraft(req.params.id, ver, 'recommendation');
      if (generatedText) {
        const finalText = await extractDocxText(Buffer.from(doc.base64, 'base64'));
        await learnFromEdit('recommendation', { companyName, generatedText, finalText });
      }
    } catch (e) {
      console.error('[learning] learnFromEdit (recommendation) failed:', e instanceof Error ? e.message : e);
    }

    res.json({ envelopeId, signers: signers.map((s) => s!.name), document: doc.name });
  } catch (err) {
    console.error('[recommendation/send-for-signing]', err);
    res.status(500).json({ error: 'Failed to send for signing', detail: err instanceof Error ? err.message : String(err) });
  }
});
