import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';

// ── Proposal structure (mirrors HealthCap's standard proposal / recommendation) ──
export interface ProposalData {
  date: string;
  location: string;
  companyInception?: string; // recommendations include an inception-year row
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

// One signature cell: an invisible anchor at the start of the underline (so the
// DocuSign tab tracks to the line), placed in its own half-page-wide column.
function signatureCell(anchor: string, side: 'left' | 'right'): TableCell {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    margins: { top: 360, ...(side === 'left' ? { right: 240 } : { left: 240 }) },
    children: [new Paragraph({ children: [
      new TextRun({ text: anchor, color: 'FFFFFF', size: 2, font: FONT }),
      new TextRun({ text: '______________________________', font: FONT, size: 20 }),
    ] })],
  });
}

export async function buildProposalDocx(
  companyName: string,
  d: ProposalData,
  opts: { title?: string; syndicateLabel?: string } = {},
): Promise<string> {
  const title = opts.title ?? 'Investment Proposal – HealthCap IX D AB and HealthCap IX E AB';
  const syndicateLabel = opts.syndicateLabel ?? 'Syndicating investors';
  const rows: TableRow[] = [
    row('Date', d.date),
    row('Company', companyName),
    row('Location', d.location),
    ...(d.companyInception ? [row('Company inception', d.companyInception)] : []),
    row(syndicateLabel, d.syndicatingInvestors),
    row('Amount and Terms', d.amountAndTerms),
    row('Pre-money Valuation', d.preMoneyValuation),
    row('Post-money Valuation', d.postMoneyValuation),
    row('Investment Horizon', d.investmentHorizon),
    ...d.sections.map(s => row(s.heading, s.content)),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      // Narrow margins (~0.6") to help the whole document fit within 3 pages.
      properties: { page: { margin: { top: 864, bottom: 864, left: 864, right: 864 } } },
      children: [
        new Paragraph({
          spacing: { after: 160 },
          children: [new TextRun({ text: title, bold: true, font: FONT, size: 24 })],
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, rows }),
        new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: 'HealthCap IX Advisor AB', bold: true, font: FONT, size: 20 })] }),
        // Two-column signature block so the two DocuSign tabs sit a half-page apart.
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: NO_BORDERS,
          rows: [new TableRow({ children: [signatureCell('{{sig1}}', 'left'), signatureCell('{{sig2}}', 'right')] })],
        }),
        new Paragraph({ children: [new TextRun({ text: 'Draft generated for internal review — verify all figures before use.', italics: true, color: '888888', font: FONT, size: 16 })], spacing: { before: 240 } }),
      ],
    }],
  });

  return Packer.toBase64String(doc);
}
