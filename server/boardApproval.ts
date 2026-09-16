import { Router } from 'express';
import sql from 'mssql';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { getPool } from './db.js';
import { askClaudeJson } from './anthropic.js';
import { rowToCompany } from './companies.js';
import { saveToSharePoint, sharePointConfigured, listCompanyFiles, getDocsByPattern } from './sharepoint.js';
import { sendEnvelope } from './docusign.js';
import { recordEnvelope } from './envelopeStore.js';

export const boardApprovalRouter = Router();

const FONT = 'Calibri';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// The two fund entities and their registration numbers.
const ENTITIES = [
  { key: 'D', name: 'HealthCap IX D AB', org: '559374-5929' },
  { key: 'E', name: 'HealthCap IX E AB', org: '559374-5572' },
] as const;

// The four fixed board signatories (with their per-person signature anchors).
const BOARD_SIGNERS = [
  { name: 'Björn Odlander', email: 'bjorn.odlander@healthcap.eu', anchor: '{{sigBjorn}}' },
  { name: 'Mårten Steen', email: 'marten.steen@healthcap.eu', anchor: '{{sigMarten}}' },
  { name: 'Alex Valcu', email: 'alex.valcu@healthcap.eu', anchor: '{{sigAlex}}' },
  { name: 'Kristina Ekberg', email: 'kristina.ekberg@healthcap.eu', anchor: '{{sigKristina}}' },
];

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };

function sv(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, font: FONT, size: 20 })] });
}
function en(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text, font: FONT, size: 20, italics: true, color: '555555' })] });
}
function heading(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text, font: FONT, size: 20, bold: true })] });
}

// One signature cell: an underline with the person's invisible anchor at its
// start, and their name below.
function sigCell(name: string, anchor: string): TableCell {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    margins: { top: 480, right: 200, left: 200 },
    children: [
      new Paragraph({ children: [
        new TextRun({ text: anchor, color: 'FFFFFF', size: 2, font: FONT }),
        new TextRun({ text: '______________________________', font: FONT, size: 20 }),
      ] }),
      new Paragraph({ children: [new TextRun({ text: name, font: FONT, size: 20 })] }),
    ],
  });
}

interface BoardData { companyName: string; invSv: string; invEn: string; }

function buildBoardApprovalDocx(entity: typeof ENTITIES[number], d: BoardData): Promise<string> {
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: {},
      children: [
        sv(`Protokoll nr _ fört vid styrelse-sammanträde per capsulam i ${entity.name}, org.nr ${entity.org}, den _____________`),
        en(`Minutes no. _ of the board meeting of ${entity.name}, Reg. No. ${entity.org}, held by correspondence on _____________`),
        sv('Deltagande styrelseledamöter:'),
        en('Board members participating:'),
        ...['Kristina Ekberg', 'Björn Odlander', 'Mårten Steen', 'Alex Valcu'].map(n =>
          new Paragraph({ children: [new TextRun({ text: n, font: FONT, size: 20 })] })),

        heading('§ 1 Protokoll och justering / Minutes and attestation of the minutes'),
        sv('Det noterades att styrelsebesluten gällande bolaget i detta protokoll fattas genom ett s.k. per capsulam-förfarande och att samtliga styrelseledamöter, genom att underteckna detta protokoll, bekräftar sitt godkännande av de beslut som antecknats häri.'),
        en('It was noted that the resolutions of the board of directors concerning the company in these minutes were adopted by correspondence and that, by signing these minutes, all board members confirm their approval of the resolutions noted herein.'),

        heading('§ 2 Nyinvestering / New investment'),
        sv(`Noterades att bolaget har mottagit en investment recommendation från rådgivningsbolaget HealthCap IX Advisor AB avseende en investering i ${d.invSv}, Bilaga 1. Noterades vidare att styrelsen har tagit del av de huvudsakliga villkoren för investeringen samt tagit del av utkast till investeringsdokumentation samt resultatet av due diligence.`),
        en(`It was noted that the company has received an investment recommendation from the advisor HealthCap IX Advisor AB regarding an investment in ${d.invEn}, Appendix 1. Furthermore, it was noted that the board of directors has reviewed the main terms and conditions of the investment, as well as draft investment documentation and the results of the due diligence.`),
        sv('Beslöts att genomföra investeringen på i huvudsak de villkor som framgår av den dokumentation som cirkulerats till ledamöterna.'),
        en('It was resolved to make the investment on, in all material respects, the terms and conditions included in the documentation that has been circulated to the board members.'),
        sv(`Uppdrogs åt Mårten Steen och Kristina Ekberg att två i förening vidta de åtgärder som de anser nödvändiga eller lämpliga för att slutföra investeringen, inklusive att underteckna alla dokument och genomföra betalningar från bolaget till ${d.companyName}.`),
        en(`It was resolved to instruct Mårten Steen and Kristina Ekberg – two jointly – to carry out all measures that they deem necessary or advisable in order to make the investment, including to sign all documents and make payments from the company to ${d.companyName}.`),

        new Paragraph({ spacing: { before: 200, after: 100 }, alignment: undefined, children: [new TextRun({ text: '***', font: FONT, size: 20 })] }),
        sv('Signatursida bifogas separat / Signature page separately attached'),
        new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: 'För godkännande av ovan listade beslut', font: FONT, size: 20 })] }),
        en('I hereby approve the resolutions listed above'),

        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: NO_BORDERS,
          rows: [
            new TableRow({ children: [sigCell('Björn Odlander', '{{sigBjorn}}'), sigCell('Mårten Steen', '{{sigMarten}}')] }),
            new TableRow({ children: [sigCell('Alex Valcu', '{{sigAlex}}'), sigCell('Kristina Ekberg', '{{sigKristina}}')] }),
          ],
        }),
      ],
    }],
  });
  return Packer.toBase64String(doc);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCompany(id: string): Promise<any> {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.NVarChar(50), id).query('SELECT * FROM companies WHERE id = @id');
  if (result.recordset.length === 0) throw new Error('Company not found');
  return rowToCompany(result.recordset[0]);
}

const BOARD_FILE = (companyName: string, entityName: string) =>
  `${companyName.replace(/[^a-z0-9 _-]/gi, '_')} — Board Approval ${entityName}.docx`;

// Generate the two board-approval protocols and save them to the company's
// SharePoint folder. Idempotent: skips if both already exist.
export async function generateBoardApprovals(companyId: string, companyName?: string): Promise<{ generated: string[]; skipped: boolean }> {
  const c = companyName ? { name: companyName, location: undefined } : await loadCompany(companyId);
  const name: string = c.name;
  if (!sharePointConfigured()) return { generated: [], skipped: true };

  // Idempotency — don't overwrite protocols that already exist.
  const existing = (await listCompanyFiles(name)).map(f => f.name);
  const targets = ENTITIES.map(e => BOARD_FILE(name, e.name));
  if (targets.every(t => existing.includes(t))) return { generated: [], skipped: true };

  // Company nationality for the "det <adj> bolaget <name>" phrasing (best-effort).
  let svAdj = '', enAdj = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loc = (c as any).location ?? (await loadCompany(companyId)).location;
    const r = await askClaudeJson<{ svAdjective: string; enAdjective: string }>({
      content: `The company "${name}" is located in: ${loc ?? 'unknown'}. Return ONLY JSON {"svAdjective": Swedish nationality adjective in lowercase (e.g. amerikanska, svenska, danska, schweiziska, brittiska, tyska), "enAdjective": English nationality adjective (e.g. American, Swedish, Danish, Swiss)}. If the country is unknown, return empty strings.`,
      model: 'claude-sonnet-4-5', maxTokens: 200,
    });
    svAdj = String(r.svAdjective ?? '').trim();
    enAdj = String(r.enAdjective ?? '').trim();
  } catch { /* leave adjectives blank */ }

  const invSv = svAdj ? `det ${svAdj} bolaget ${name}` : `bolaget ${name}`;
  const invEn = enAdj ? `the ${enAdj} company ${name}` : `the company ${name}`;

  const generated: string[] = [];
  for (const entity of ENTITIES) {
    const base64 = await buildBoardApprovalDocx(entity, { companyName: name, invSv, invEn });
    const fileName = BOARD_FILE(name, entity.name);
    await saveToSharePoint(name, fileName, base64, DOCX_TYPE);
    generated.push(fileName);
  }
  return { generated, skipped: false };
}

// GET — status for the UI: the two protocols (if generated) and whether the
// recommendation / board approvals have been signed.
boardApprovalRouter.get('/api/companies/:id/board-approvals', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', req.params.id).query('SELECT name FROM companies WHERE id = @id');
    const name: string | undefined = r.recordset[0]?.name;
    if (!name) return res.status(404).json({ error: 'Company not found.' });
    const files = sharePointConfigured() ? await listCompanyFiles(name) : [];
    const docs = files.filter(f => /Board Approval HealthCap IX [DE] AB\.docx$/i.test(f.name));
    res.json({
      docs,
      recommendationSigned: files.some(f => /Investment Recommendation \(Signed\)\.pdf$/i.test(f.name)),
      boardSigned: files.some(f => /Board Approvals \(Signed\)\.pdf$/i.test(f.name)),
    });
  } catch (err) {
    console.error('[board-approvals GET]', err);
    res.status(500).json({ error: 'Failed to load board approvals', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST — manual generation fallback (normally auto on recommendation signing).
boardApprovalRouter.post('/api/companies/:id/board-approvals/generate', async (req, res) => {
  try {
    const result = await generateBoardApprovals(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[board-approvals generate]', err);
    res.status(500).json({ error: 'Failed to generate board approvals', detail: err instanceof Error ? err.message : String(err) });
  }
});

// POST — send both protocols in one envelope to the four fixed signatories.
boardApprovalRouter.post('/api/companies/:id/board-approvals/send-for-signing', async (req, res) => {
  try {
    if (!sharePointConfigured()) return res.status(400).json({ error: 'SharePoint is not configured.' });
    const pool = await getPool();
    const r = await pool.request().input('id', req.params.id).query('SELECT name FROM companies WHERE id = @id');
    const name: string | undefined = r.recordset[0]?.name;
    if (!name) return res.status(404).json({ error: 'Company not found.' });

    const docs = await getDocsByPattern(name, /Board Approval HealthCap IX [DE] AB\.docx$/i);
    if (docs.length < 2) return res.status(400).json({ error: 'Both board-approval protocols must be generated first.' });

    const { envelopeId, tabDiagnostics } = await sendEnvelope({
      documents: docs.map(d => ({ base64: d.base64, name: d.name })),
      emailSubject: `Board Approvals for signature – ${name}`,
      signers: BOARD_SIGNERS.map(s => ({ name: s.name, email: s.email, anchor: s.anchor })),
    });
    try { await recordEnvelope(envelopeId, req.params.id, name, 'board-approval'); }
    catch (e) { console.error('[board-approvals] recordEnvelope failed:', e instanceof Error ? e.message : e); }

    res.json({ envelopeId, signers: BOARD_SIGNERS.map(s => s.name), documents: docs.map(d => d.name), tabDiagnostics });
  } catch (err) {
    console.error('[board-approvals send]', err);
    res.status(500).json({ error: 'Failed to send board approvals for signing', detail: err instanceof Error ? err.message : String(err) });
  }
});
