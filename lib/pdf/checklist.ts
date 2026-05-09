// Render the objective checklist block onto a pdf-lib PDFPage.
//
// Each row is a small empty checkbox (vector square) followed by the imperative
// objective text. Text wraps within the rect width. Rows whose `countMismatch`
// is set get a visible amber dot at the right edge so Andrew sees the mismatch
// before printing (per plan.md R5).

import { rgb as pdfRgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Objective } from "@/lib/objectives";

export interface ChecklistRenderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChecklistRenderOptions {
  bold: PDFFont;
  regular: PDFFont;
  /** Default 9pt. */
  fontSize?: number;
  /** Default true. */
  showMismatchBadge?: boolean;
}

const BLACK = pdfRgb(0, 0, 0);
const AMBER = pdfRgb(0.9, 0.55, 0.1);
const CHECKBOX_BORDER = pdfRgb(0.2, 0.2, 0.2);

const CHECKBOX_PT = 9;
const CHECKBOX_GAP_PT = 6;
const ROW_GAP_PT = 4;

/**
 * Wrap a string into an array of lines that each fit within `maxWidth` when
 * measured with `font` at `size`. Greedy word-by-word wrapping; words that are
 * themselves longer than maxWidth are kept on their own line (no mid-word
 * breaking — checklists never need it for our content).
 */
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (maxWidth <= 0) return [text];
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    const w = font.widthOfTextAtSize(candidate, size);
    if (w <= maxWidth) {
      current = candidate;
    } else {
      if (current.length > 0) lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

export function renderChecklist(
  page: PDFPage,
  objectives: Objective[],
  rect: ChecklistRenderRect,
  options: ChecklistRenderOptions,
): void {
  if (objectives.length === 0) return;
  const fontSize = options.fontSize ?? 9;
  const showBadge = options.showMismatchBadge ?? true;
  const lineHeight = fontSize + 3;
  const badgeWidth = showBadge ? 12 : 0;

  // Text starts after the checkbox + gap on the left, ends before the badge
  // gutter on the right.
  const textX = rect.x + CHECKBOX_PT + CHECKBOX_GAP_PT;
  const textMaxWidth = Math.max(
    10,
    rect.width - CHECKBOX_PT - CHECKBOX_GAP_PT - badgeWidth - 2,
  );

  // We render top-down within the rect (PDF y grows upward, so start at the
  // top edge and decrement). Stop drawing once we run out of vertical room.
  let cursorY = rect.y + rect.height;
  const minY = rect.y;

  for (const obj of objectives) {
    const lines = wrapText(obj.text, options.regular, fontSize, textMaxWidth);
    if (lines.length === 0) continue;

    const blockHeight = lines.length * lineHeight;
    if (cursorY - blockHeight < minY) {
      // Out of vertical room; stop rendering further objectives gracefully.
      break;
    }

    // Checkbox is centered vertically against the first text line.
    const firstLineBaselineY = cursorY - fontSize;
    const checkboxX = rect.x;
    const checkboxY = firstLineBaselineY + (fontSize - CHECKBOX_PT) / 2;
    page.drawRectangle({
      x: checkboxX,
      y: checkboxY,
      width: CHECKBOX_PT,
      height: CHECKBOX_PT,
      borderColor: CHECKBOX_BORDER,
      borderWidth: 0.8,
      color: pdfRgb(1, 1, 1),
    });

    // Text lines.
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) continue;
      const baselineY = cursorY - fontSize - i * lineHeight;
      page.drawText(line, {
        x: textX,
        y: baselineY,
        size: fontSize,
        font: options.regular,
        color: BLACK,
      });
    }

    // Mismatch badge: an amber dot at the right edge of the first text line,
    // plus a tiny "!" inside in bold to make it impossible to miss.
    if (showBadge && obj.countMismatch !== undefined) {
      const badgeRadius = 4;
      const badgeCx = rect.x + rect.width - badgeRadius - 1;
      const badgeCy = firstLineBaselineY + fontSize / 2 - 1;
      page.drawCircle({
        x: badgeCx,
        y: badgeCy,
        size: badgeRadius,
        color: AMBER,
        borderColor: AMBER,
        borderWidth: 0,
      });
      // Mark with an exclamation so it reads as a warning even in B&W print.
      const mark = "!";
      const markSize = 7;
      const markWidth = options.bold.widthOfTextAtSize(mark, markSize);
      page.drawText(mark, {
        x: badgeCx - markWidth / 2,
        y: badgeCy - markSize / 2 + 1,
        size: markSize,
        font: options.bold,
        color: pdfRgb(1, 1, 1),
      });
    }

    cursorY -= blockHeight + ROW_GAP_PT;
  }
}
