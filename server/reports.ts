import { Router } from 'express';
import sql from 'mssql';
import type PptxGenJS from 'pptxgenjs';
import { getPool } from './db.js';
import { askClaudeJson } from './anthropic.js';
import { rowToCompany } from './companies.js';
import { newDeck, toBase64, footer, headerBar, coverSlide, TEAL, WHITE, DARK, LIGHT_TEAL, GRAY } from './pptx.js';

interface CompetitiveProgram {
  company: string;
  program: string;
  indication: string;
  stage: string;
  modality: string;
}

interface CompetitiveLandscapeData {
  marketOverview: string;
  competitivePrograms: CompetitiveProgram[];
  differentiation: string[];
  competitiveRisks: string[];
  overallAssessment: string;
}

export async function buildCompetitiveLandscapePptx(
  companyName: string,
  data: CompetitiveLandscapeData,
): Promise<string> {
  const pptx = newDeck();

  // ── Slide 1: Cover ─────────────────────────────────────────────────────────
  coverSlide(pptx, 'COMPETITIVE LANDSCAPE', companyName);

  // ── Slide 2: Market Overview ─────────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };
    headerBar(pptx, slide, 'Market Overview', companyName);
    slide.addText(data.marketOverview, {
      x: 0.4, y: 1.25, w: 12.5, h: 5.8,
      fontSize: 14, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true,
    });
    footer(pptx, slide);
  }

  // ── Slide 3: Competitive Programs ────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };
    headerBar(pptx, slide, 'Competitive Programs', companyName);

    // Table — one row per program
    const colW = [3.0, 2.2, 2.8, 1.8, 3.13]; // Company | Program | Indication | Stage | Modality
    const headers = ['Company', 'Program', 'Indication', 'Stage', 'Modality / Notes'];

    const tableRows: PptxGenJS.TableRow[] = [
      headers.map(h => ({
        text: h,
        options: { bold: true, color: WHITE, fill: { color: TEAL }, fontSize: 10, fontFace: 'Calibri', align: 'center' as const, valign: 'middle' as const },
      })),
      ...data.competitivePrograms.map((p, i) => {
        const isTarget = p.company.toLowerCase().includes(companyName.toLowerCase());
        const rowFill = isTarget ? LIGHT_TEAL : (i % 2 === 0 ? WHITE : GRAY);
        return [p.company, p.program, p.indication, p.stage, p.modality].map(cell => ({
          text: cell || '—',
          options: { bold: isTarget, color: DARK, fill: { color: rowFill }, fontSize: 9, fontFace: 'Calibri', align: 'left' as const, valign: 'middle' as const },
        }));
      }),
    ];

    slide.addTable(tableRows, {
      x: 0.4, y: 1.15, w: 12.53, rowH: 0.35, colW,
      border: { type: 'solid', color: LIGHT_TEAL, pt: 0.5 },
    });
    footer(pptx, slide);
  }

  // ── Slide 4: Differentiation & Risks ─────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };
    headerBar(pptx, slide, 'Differentiation & Competitive Risks', companyName);

    // Left column: Differentiation
    slide.addShape(pptx.ShapeType.rect, { x: 0.4, y: 1.15, w: 5.9, h: 0.45, fill: { color: TEAL }, line: { color: TEAL, width: 0 } });
    slide.addText('Differentiation', { x: 0.4, y: 1.15, w: 5.9, h: 0.45, fontSize: 12, bold: true, color: WHITE, fontFace: 'Calibri', align: 'center', valign: 'middle' });
    slide.addText(
      data.differentiation.map(d => ({ text: d, options: { bullet: { indent: 10 }, paraSpaceAfter: 6 } })),
      { x: 0.4, y: 1.65, w: 5.9, h: 5.15, fontSize: 11, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true },
    );

    // Right column: Risks
    slide.addShape(pptx.ShapeType.rect, { x: 7.0, y: 1.15, w: 5.9, h: 0.45, fill: { color: '9B1C1C' }, line: { color: '9B1C1C', width: 0 } });
    slide.addText('Competitive Risks', { x: 7.0, y: 1.15, w: 5.9, h: 0.45, fontSize: 12, bold: true, color: WHITE, fontFace: 'Calibri', align: 'center', valign: 'middle' });
    slide.addText(
      data.competitiveRisks.map(r => ({ text: r, options: { bullet: { indent: 10 }, paraSpaceAfter: 6 } })),
      { x: 7.0, y: 1.65, w: 5.9, h: 5.15, fontSize: 11, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true },
    );

    slide.addShape(pptx.ShapeType.line, { x: 6.67, y: 1.15, w: 0, h: 5.65, line: { color: LIGHT_TEAL, width: 1 } });
    footer(pptx, slide);
  }

  // ── Slide 5: Overall Assessment ──────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };
    headerBar(pptx, slide, 'Overall Assessment', companyName);
    slide.addShape(pptx.ShapeType.rect, { x: 0.4, y: 1.15, w: 12.53, h: 5.7, fill: { color: GRAY }, line: { color: LIGHT_TEAL, width: 1 } });
    slide.addShape(pptx.ShapeType.rect, { x: 0.4, y: 1.15, w: 0.12, h: 5.7, fill: { color: TEAL }, line: { color: TEAL, width: 0 } });
    slide.addText(data.overallAssessment, { x: 0.75, y: 1.35, w: 11.9, h: 5.3, fontSize: 14, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true });
    footer(pptx, slide);
  }

  return toBase64(pptx);
}

export const reportsRouter = Router();

// POST /api/companies/:id/reports/competitive-landscape
// Generates a competitive landscape analysis for the company using Claude,
// saves the result as a PPTX in the company's Files tab, and returns the report text.
reportsRouter.post('/api/companies/:id/reports/competitive-landscape', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar(50), req.params.id)
      .query('SELECT * FROM companies WHERE id = @id');
    if (result.recordset.length === 0) { res.status(404).json({ error: 'Company not found' }); return; }
    const c = rowToCompany(result.recordset[0]);

    const prompt = `You are a healthcare and life science venture capital analyst at HealthCap, a leading Nordic life science VC firm.

Analyse the competitive landscape for the following company and return ONLY a valid JSON object — no markdown fences, no prose outside the JSON.

Company: ${c.name}
Description: ${c.description || 'N/A'}
Sector: ${c.sector || 'N/A'}
Therapeutic Area: ${c.therapeuticArea || 'N/A'}
Development Stage: ${c.developmentStage || 'N/A'}
Location: ${c.location || 'N/A'}
Website: ${c.website || 'N/A'}

Return this exact JSON structure:
{
  "marketOverview": "2-4 sentence description of the market/indication, addressable patient population, and unmet medical need",
  "competitivePrograms": [
    {
      "company": "Company name (put ${c.name} as the first entry)",
      "program": "Asset or program name / code (e.g. drug name, platform, or 'Undisclosed')",
      "indication": "Primary indication or disease area",
      "stage": "Development stage (e.g. Preclinical, IND-stage, Phase I, Phase II, Phase III, Marketed)",
      "modality": "Modality or mechanism of action (e.g. mAb, ADC, small molecule, gene therapy, cell therapy, etc.)"
    }
  ],
  "differentiation": [
    "Differentiator point 1 — be specific",
    "Differentiator point 2",
    "Differentiator point 3"
  ],
  "competitiveRisks": [
    "Risk 1 — be specific about the competitive threat",
    "Risk 2",
    "Risk 3"
  ],
  "overallAssessment": "2-3 sentence summary of ${c.name}'s competitive position, highlighting the key opportunity and the most significant challenge."
}

Rules:
- List EVERY major competitor program as a separate entry in competitivePrograms (one entry = one development program)
- If a company has multiple programs in the same indication, list each separately
- Be specific — use real company/drug names where known
- If data is limited, note this in the overallAssessment`;

    const data = await askClaudeJson<CompetitiveLandscapeData>({
      content: prompt, model: 'claude-opus-4-5', maxTokens: 3000,
    });

    // Build human-readable text report (shown in the DD Reports card)
    const report = [
      `COMPETITIVE LANDSCAPE: ${c.name}`,
      '',
      '── MARKET OVERVIEW ──',
      data.marketOverview,
      '',
      '── COMPETITIVE PROGRAMS ──',
      ['Company', 'Program', 'Indication', 'Stage', 'Modality'].join(' | '),
      ...data.competitivePrograms.map(p =>
        [p.company, p.program, p.indication, p.stage, p.modality].join(' | ')
      ),
      '',
      `── ${c.name.toUpperCase()} DIFFERENTIATION ──`,
      ...data.differentiation.map(d => `• ${d}`),
      '',
      '── COMPETITIVE RISKS ──',
      ...data.competitiveRisks.map(r => `• ${r}`),
      '',
      '── OVERALL ASSESSMENT ──',
      data.overallAssessment,
    ].join('\n');

    // Generate PPTX
    const pptxBase64 = await buildCompetitiveLandscapePptx(c.name, data);
    const pptxBytes = Buffer.from(pptxBase64, 'base64');
    const now = new Date().toISOString();
    const safeName = c.name.replace(/[^a-z0-9 _-]/gi, '_');
    const fileName = `${safeName} — Competitive Landscape.pptx`;
    const newAttachment = {
      id: `${Date.now()}-cl`,
      name: fileName,
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: pptxBytes.length,
      uploadedAt: now,
      data: pptxBase64,
    };

    // Persist the new attachment to the database (append to existing attachments)
    const existingAtts: typeof c.attachments = c.attachments ?? [];
    const updatedAtts = [...existingAtts, newAttachment];
    await pool.request()
      .input('id', sql.NVarChar(50), c.id)
      .input('attachments', sql.NVarChar(sql.MAX), JSON.stringify(updatedAtts))
      .input('updated_at', sql.NVarChar(30), now)
      .query('UPDATE companies SET attachments = @attachments, updated_at = @updated_at WHERE id = @id');

    res.json({ report, attachment: newAttachment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});
