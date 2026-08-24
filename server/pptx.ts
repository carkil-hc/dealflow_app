import { createRequire } from 'node:module';
import type PptxGenJS from 'pptxgenjs';

// pptxgenjs ships an ESM build that older Node parses as CommonJS and crashes
// on at import time. Load the CommonJS build explicitly so the server boots on
// every Node version.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const Pptx: typeof PptxGenJS = require('pptxgenjs');

// ── HealthCap deck palette ───────────────────────────────────────────────────
export const TEAL = '005B6E';
export const WHITE = 'FFFFFF';
export const DARK = '1A1A1A';
export const LIGHT_TEAL = 'E0F0F5';
export const GRAY = 'F5F5F5';
export const MID_GRAY = '9CA3AF';

// Risk-level colours/labels (1 = low/green … 5 = high/red).
export const RISK_COLOR: Record<number, string> = { 1: '16A34A', 2: '059669', 3: 'F59E0B', 4: 'EA580C', 5: 'DC2626' };
export const RISK_LABEL: Record<number, string> = { 1: 'Low', 2: 'Low–Medium', 3: 'Medium', 4: 'High', 5: 'Very High' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;

// A new wide (16:9) deck.
export function newDeck(): PptxGenJS {
  const pptx = new Pptx();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches
  return pptx;
}

export async function toBase64(pptx: PptxGenJS): Promise<string> {
  return (await pptx.write({ outputType: 'base64' })) as string;
}

// Standard confidential footer line.
export function footer(pptx: PptxGenJS, slide: Slide) {
  slide.addShape(pptx.ShapeType.line, { x: 0.4, y: 7.15, w: 12.53, h: 0, line: { color: LIGHT_TEAL, width: 1 } });
  slide.addText('HealthCap — Confidential', { x: 0.4, y: 7.2, w: 12.5, h: 0.25, fontSize: 8, color: MID_GRAY, fontFace: 'Calibri' });
}

// Teal header bar with a title (left) and the company name (right).
export function headerBar(pptx: PptxGenJS, slide: Slide, title: string, companyName: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.0, fill: { color: TEAL }, line: { color: TEAL, width: 0 } });
  slide.addText(title, { x: 0.4, y: 0.15, w: 9.2, h: 0.7, fontSize: 22, bold: true, color: WHITE, fontFace: 'Calibri', valign: 'middle' });
  slide.addText(companyName, { x: 9.6, y: 0.2, w: 3.4, h: 0.6, fontSize: 12, color: LIGHT_TEAL, fontFace: 'Calibri', align: 'right', valign: 'middle' });
}

// Full-bleed teal cover slide with the HealthCap wordmark, a title, a subtitle,
// and the generated date. Returns the slide for any extra additions.
export function coverSlide(pptx: PptxGenJS, title: string, subtitle: string): Slide {
  const c = pptx.addSlide();
  c.background = { color: TEAL };
  c.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.08, h: 7.5, fill: { color: WHITE }, line: { color: WHITE, width: 0 } });
  c.addText('HealthCap', { x: 0.3, y: 0.35, w: 3, h: 0.4, fontSize: 14, bold: true, color: WHITE, fontFace: 'Calibri' });
  c.addText(title, { x: 0.3, y: 1.6, w: 12.7, h: 0.8, fontSize: 34, bold: true, color: WHITE, fontFace: 'Calibri' });
  c.addText(subtitle, { x: 0.3, y: 2.5, w: 12.7, h: 0.7, fontSize: 26, color: LIGHT_TEAL, fontFace: 'Calibri' });
  c.addText(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    { x: 0.3, y: 6.9, w: 12.7, h: 0.35, fontSize: 10, color: LIGHT_TEAL, fontFace: 'Calibri' });
  return c;
}
