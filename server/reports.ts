import { Router } from 'express';
import sql from 'mssql';
import PptxGenJS from 'pptxgenjs';
import { getPool } from './db.js';
import { anthropic } from './anthropic.js';
import { rowToCompany } from './companies.js';

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

async function buildCompetitiveLandscapePptx(
  companyName: string,
  data: CompetitiveLandscapeData,
): Promise<string> {
  const TEAL = '005B6E';
  const WHITE = 'FFFFFF';
  const DARK = '1A1A1A';
  const LIGHT_TEAL = 'E0F0F5';
  const GRAY = 'F5F5F5';
  const MID_GRAY = '9CA3AF';

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches

  // ── Slide 1: Title ───────────────────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: TEAL };

    // HealthCap wordmark area (top-left accent bar)
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.08, h: 7.5, fill: { color: WHITE }, line: { color: WHITE, width: 0 },
    });

    slide.addText('HealthCap', {
      x: 0.3, y: 0.35, w: 3, h: 0.4,
      fontSize: 14, bold: true, color: WHITE, fontFace: 'Calibri',
    });

    slide.addText('COMPETITIVE LANDSCAPE', {
      x: 0.3, y: 1.6, w: 12.7, h: 0.7,
      fontSize: 36, bold: true, color: WHITE, fontFace: 'Calibri',
    });

    slide.addText(companyName, {
      x: 0.3, y: 2.4, w: 12.7, h: 0.7,
      fontSize: 28, bold: false, color: LIGHT_TEAL, fontFace: 'Calibri',
    });

    slide.addText(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, {
      x: 0.3, y: 6.9, w: 12.7, h: 0.35,
      fontSize: 10, color: LIGHT_TEAL, fontFace: 'Calibri',
    });
  }

  // ── Slide 2: Market Overview ─────────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Market Overview', {
      x: 0.4, y: 0.15, w: 10, h: 0.7,
      fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    slide.addText(companyName, {
      x: 9.5, y: 0.2, w: 3.5, h: 0.6,
      fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right',
    });

    // Body
    slide.addText(data.marketOverview, {
      x: 0.4, y: 1.25, w: 12.5, h: 5.8,
      fontSize: 14, color: DARK, fontFace: 'Calibri', valign: 'top',
      wrap: true,
    });

    // Footer line
    slide.addShape(pptx.ShapeType.line, {
      x: 0.4, y: 7.15, w: 12.53, h: 0,
      line: { color: LIGHT_TEAL, width: 1 },
    });
    slide.addText('HealthCap — Confidential', {
      x: 0.4, y: 7.2, w: 12.5, h: 0.25,
      fontSize: 8, color: MID_GRAY, fontFace: 'Calibri',
    });
  }

  // ── Slide 3: Competitive Programs ────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Competitive Programs', {
      x: 0.4, y: 0.15, w: 10, h: 0.7,
      fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    slide.addText(companyName, {
      x: 9.5, y: 0.2, w: 3.5, h: 0.6,
      fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right',
    });

    // Table — one row per program
    const colW = [3.0, 2.2, 2.8, 1.8, 3.13]; // Company | Program | Indication | Stage | Modality
    const headers = ['Company', 'Program', 'Indication', 'Stage', 'Modality / Notes'];

    const tableRows: PptxGenJS.TableRow[] = [
      // Header row
      headers.map(h => ({
        text: h,
        options: {
          bold: true,
          color: WHITE,
          fill: { color: TEAL },
          fontSize: 10,
          fontFace: 'Calibri',
          align: 'center' as const,
          valign: 'middle' as const,
        },
      })),
      // Data rows — one per program
      ...data.competitivePrograms.map((p, i) => {
        const isTarget = p.company.toLowerCase().includes(companyName.toLowerCase());
        const rowFill = isTarget ? LIGHT_TEAL : (i % 2 === 0 ? WHITE : GRAY);
        return [p.company, p.program, p.indication, p.stage, p.modality].map(cell => ({
          text: cell || '—',
          options: {
            bold: isTarget,
            color: DARK,
            fill: { color: rowFill },
            fontSize: 9,
            fontFace: 'Calibri',
            align: 'left' as const,
            valign: 'middle' as const,
          },
        }));
      }),
    ];

    slide.addTable(tableRows, {
      x: 0.4, y: 1.15, w: 12.53,
      rowH: 0.35,
      colW,
      border: { type: 'solid', color: LIGHT_TEAL, pt: 0.5 },
    });

    // Footer
    slide.addShape(pptx.ShapeType.line, {
      x: 0.4, y: 7.15, w: 12.53, h: 0,
      line: { color: LIGHT_TEAL, width: 1 },
    });
    slide.addText('HealthCap — Confidential', {
      x: 0.4, y: 7.2, w: 12.5, h: 0.25,
      fontSize: 8, color: MID_GRAY, fontFace: 'Calibri',
    });
  }

  // ── Slide 4: Differentiation & Risks ─────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Differentiation & Competitive Risks', {
      x: 0.4, y: 0.15, w: 10, h: 0.7,
      fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    slide.addText(companyName, {
      x: 9.5, y: 0.2, w: 3.5, h: 0.6,
      fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right',
    });

    // Left column: Differentiation
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 1.15, w: 5.9, h: 0.45,
      fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Differentiation', {
      x: 0.4, y: 1.15, w: 5.9, h: 0.45,
      fontSize: 12, bold: true, color: WHITE, fontFace: 'Calibri', align: 'center', valign: 'middle',
    });

    const diffItems = data.differentiation.map(d => ({ text: d, options: { bullet: { indent: 10 }, paraSpaceAfter: 6 } }));
    slide.addText(diffItems, {
      x: 0.4, y: 1.65, w: 5.9, h: 5.15,
      fontSize: 11, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true,
    });

    // Right column: Risks
    slide.addShape(pptx.ShapeType.rect, {
      x: 7.0, y: 1.15, w: 5.9, h: 0.45,
      fill: { color: '9B1C1C' }, line: { color: '9B1C1C', width: 0 },
    });
    slide.addText('Competitive Risks', {
      x: 7.0, y: 1.15, w: 5.9, h: 0.45,
      fontSize: 12, bold: true, color: WHITE, fontFace: 'Calibri', align: 'center', valign: 'middle',
    });

    const riskItems = data.competitiveRisks.map(r => ({ text: r, options: { bullet: { indent: 10 }, paraSpaceAfter: 6 } }));
    slide.addText(riskItems, {
      x: 7.0, y: 1.65, w: 5.9, h: 5.15,
      fontSize: 11, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true,
    });

    // Divider line between columns
    slide.addShape(pptx.ShapeType.line, {
      x: 6.67, y: 1.15, w: 0, h: 5.65,
      line: { color: LIGHT_TEAL, width: 1 },
    });

    // Footer
    slide.addShape(pptx.ShapeType.line, {
      x: 0.4, y: 7.15, w: 12.53, h: 0,
      line: { color: LIGHT_TEAL, width: 1 },
    });
    slide.addText('HealthCap — Confidential', {
      x: 0.4, y: 7.2, w: 12.5, h: 0.25,
      fontSize: 8, color: MID_GRAY, fontFace: 'Calibri',
    });
  }

  // ── Slide 5: Overall Assessment ──────────────────────────────────────────
  {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });
    slide.addText('Overall Assessment', {
      x: 0.4, y: 0.15, w: 10, h: 0.7,
      fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri',
    });
    slide.addText(companyName, {
      x: 9.5, y: 0.2, w: 3.5, h: 0.6,
      fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right',
    });

    // Light accent box
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 1.15, w: 12.53, h: 5.7,
      fill: { color: GRAY }, line: { color: LIGHT_TEAL, width: 1 },
    });
    // Teal left accent
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.4, y: 1.15, w: 0.12, h: 5.7,
      fill: { color: TEAL }, line: { color: TEAL, width: 0 },
    });

    slide.addText(data.overallAssessment, {
      x: 0.75, y: 1.35, w: 11.9, h: 5.3,
      fontSize: 14, color: DARK, fontFace: 'Calibri', valign: 'top', wrap: true,
    });

    // Footer
    slide.addShape(pptx.ShapeType.line, {
      x: 0.4, y: 7.15, w: 12.53, h: 0,
      line: { color: LIGHT_TEAL, width: 1 },
    });
    slide.addText('HealthCap — Confidential', {
      x: 0.4, y: 7.2, w: 12.5, h: 0.25,
      fontSize: 8, color: MID_GRAY, fontFace: 'Calibri',
    });
  }

  const base64 = await pptx.write({ outputType: 'base64' }) as string;
  return base64;
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

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');

    // Extract JSON
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');
    const data: CompetitiveLandscapeData = JSON.parse(jsonMatch[0]);

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
