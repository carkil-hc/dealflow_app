import { Router } from 'express';
import { createRequire } from 'node:module';
import sql from 'mssql';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType,
} from 'docx';
import { getPool } from './db.js';
import { askClaudeJson } from './anthropic.js';
import { rowToCompany } from './companies.js';
import { saveToSharePoint, sharePointConfigured, getProposalFromSharePoint } from './sharepoint.js';
import { SIGNERS, sendForSignature, docusignConfigured } from './docusign.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const { parseOffice } = require('officeparser') as { parseOffice: (input: Buffer, cfg?: any) => Promise<any> };

// Office (non-PDF) mime types we extract text from.
const OFFICE_FILETYPE: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

// ── Proposal structure (mirrors HealthCap's standard proposal) ───────────────
interface ProposalData {
  date: string;
  location: string;
  syndicatingInvestors: string;
  amountAndTerms: string;
  preMoneyValuation: string;
  postMoneyValuation: string;
  investmentHorizon: string;
  sections: { heading: string; content: string }[];
}

// ── Word rendering ───────────────────────────────────────────────────────────
const FONT = 'Calibri';
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };

function labelCell(text: string): TableCell {
  return new TableCell({
    width: { size: 26, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, right: 160 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, font: FONT, size: 20 })] })],
  });
}

function contentCell(text: string): TableCell {
  const paras = String(text || '').split('\n').filter(l => l.trim().length > 0);
  return new TableCell({
    width: { size: 74, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60 },
    children: (paras.length ? paras : ['']).map(p =>
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: p, font: FONT, size: 20 })] })),
  });
}

function row(label: string, content: string): TableRow {
  return new TableRow({ children: [labelCell(label), contentCell(content)] });
}

export async function buildProposalDocx(companyName: string, d: ProposalData): Promise<string> {
  const rows: TableRow[] = [
    row('Date', d.date),
    row('Company', companyName),
    row('Location', d.location),
    row('Syndicating investors', d.syndicatingInvestors),
    row('Amount and Terms', d.amountAndTerms),
    row('Pre-money Valuation', d.preMoneyValuation),
    row('Post-money Valuation', d.postMoneyValuation),
    row('Investment Horizon', d.investmentHorizon),
    ...d.sections.map(s => row(s.heading, s.content)),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          spacing: { after: 240 },
          children: [new TextRun({ text: 'Investment Proposal – HealthCap IX D AB and HealthCap IX E AB', bold: true, font: FONT, size: 24 })],
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, rows }),
        new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: 'HealthCap IX Advisor AB', bold: true, font: FONT, size: 20 })] }),
        new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: '______________________________          ______________________________', font: FONT, size: 20 })] }),
        // Invisible DocuSign anchors (white, tiny) so signature blocks auto-place.
        new Paragraph({ children: [
          new TextRun({ text: '{{sig1}}', color: 'FFFFFF', size: 2, font: FONT }),
          new TextRun({ text: '                                                       ', size: 2, font: FONT }),
          new TextRun({ text: '{{sig2}}', color: 'FFFFFF', size: 2, font: FONT }),
        ] }),
        new Paragraph({ children: [new TextRun({ text: 'Draft generated for internal review — verify all figures before use.', italics: true, color: '888888', font: FONT, size: 16 })], spacing: { before: 240 } }),
      ],
    }],
  });

  return Packer.toBase64String(doc);
}

// ── Route ────────────────────────────────────────────────────────────────────
export const investmentProposalRouter = Router();

// Draft the proposal and return it as an attachment (the client saves it to
// Files). Synchronous within the request — reliable on App Service, and fast
// enough to fit the HTTP timeout by using Sonnet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildProposalAttachment(id: string, version = 1): Promise<any> {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.NVarChar(50), id).query('SELECT * FROM companies WHERE id = @id');
    if (result.recordset.length === 0) throw new Error('Company not found');
    const c = rowToCompany(result.recordset[0]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const atts: any[] = (c.attachments ?? []).filter((a: any) => a && a.data);
    const content: Anthropic.MessageParam['content'] = [];
    const CAP = 20 * 1024 * 1024;
    let used = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of atts as any[]) {
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

    content.push({
      type: 'text',
      text: `You are an investment professional at HealthCap, a Nordic life-science VC, drafting an Investment Proposal for the company below, to be reviewed by the investment committee. Reproduce HealthCap's standard proposal structure exactly. Return ONLY a valid JSON object:
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
- Match a concise, formal ~2-3 page style: each section 1-3 short paragraphs. Use "\\n" to separate paragraphs within a section's content.
- "Recommendation" should, in the standard house style, recommend that HealthCap IX conducts in-depth due diligence to evaluate the opportunity, unless the materials clearly indicate a different recommendation.

Company data (from the deal system):
${JSON.stringify(fields, null, 2)}`,
    });

    const data = await askClaudeJson<ProposalData>({ content, model: 'claude-sonnet-4-5', maxTokens: 8000 });

    const base64 = await buildProposalDocx(c.name, data);
    const bytes = Buffer.from(base64, 'base64');
    const safe = c.name.replace(/[^a-z0-9 _-]/gi, '_');
    const suffix = version > 1 ? ` (v${version})` : '';
    const attachment = {
      id: `${Date.now()}-ip`,
      name: `${safe} — Investment Proposal${suffix}.docx`,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: bytes.length,
      uploadedAt: new Date().toISOString(),
      data: base64,
    };
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

// GET /api/signers — the server-authoritative signer allowlist for the dropdown.
investmentProposalRouter.get('/api/signers', (_req, res) => {
  res.json({ signers: SIGNERS });
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

    const { envelopeId } = await sendForSignature({
      documentBase64: proposal.base64,
      documentName: proposal.name,
      emailSubject: `Investment Proposal for signature – ${companyName}`,
      signers: signers as { name: string; email: string }[],
    });

    res.json({ envelopeId, signers: signers.map((s) => s!.name), document: proposal.name });
  } catch (err) {
    console.error('[send-for-signing]', err);
    res.status(500).json({ error: 'Failed to send for signing', detail: err instanceof Error ? err.message : String(err) });
  }
});
