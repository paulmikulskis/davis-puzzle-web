// Render the assembly target panel + cutout strip onto a pdf-lib PDFPage.
// Cutout-side and target-slot squares share the same `cutoutSize` constant —
// pixel parity is non-negotiable so a 22pt cutout pastes into a 22pt slot.

import {
  rgb as pdfRgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { Assembly, AssemblySlot, CutoutSpec } from "@/lib/assemblies";

export type CutoutSize = "small" | "medium" | "large";

export const CUTOUT_SIZE_PT: Record<CutoutSize, number> = {
  small: 16,
  medium: 22,
  large: 28,
};

export const CUTOUT_BORDER_PT = 1.0;

/** Resolves an itemRef → embedded PDFImage. Pass an empty map to render slot
 * outlines without any sprites. */
export type SpriteResolver = (itemRef: string) => PDFImage | undefined;

export interface AssemblyRenderRect {
  /** Bottom-left of the panel region in PDF points. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AssemblyRenderOptions {
  cutoutSize: CutoutSize;
  /** Show the answer-key state (defaultItem → answerItem; pre-pasted slots). */
  showAnswerKey?: boolean;
  /** Whether the answer key is pre-pasted (slots filled) or blank. */
  answerKeyMode?: "pre-pasted" | "blank";
  /** Resolves sprite images. Optional — without it, slots show just outlines. */
  spriteResolver?: SpriteResolver;
  /** Helvetica-Bold font handle for the assembly description label. */
  labelFont?: PDFFont;
}

const BLACK = pdfRgb(0, 0, 0);
const PASTE_BG = pdfRgb(0.97, 0.97, 0.97);
const SLOT_BORDER = pdfRgb(0.5, 0.5, 0.5);

/**
 * Lay out the assembly target. Returns the bounding box used so callers can
 * stack the cutout strip below.
 */
export function renderAssemblyTarget(
  page: PDFPage,
  assembly: Assembly,
  rect: AssemblyRenderRect,
  options: AssemblyRenderOptions,
): { width: number; height: number; cellPt: number } {
  const cellPt = CUTOUT_SIZE_PT[options.cutoutSize];
  const rows = assembly.gridShape.length;
  const cols = Math.max(1, ...assembly.gridShape.map((r) => r.length));

  // Center horizontally; place top of the assembly at top of rect.
  const labelHeight = 14;
  const width = cols * cellPt;
  const startX = rect.x + (rect.width - width) / 2;
  const topY = rect.y + rect.height; // top edge of region in PDF points

  // Description label.
  if (options.labelFont) {
    const label = assembly.displayName;
    const labelSize = 10;
    const textWidth = options.labelFont.widthOfTextAtSize(label, labelSize);
    page.drawText(label, {
      x: startX + (width - textWidth) / 2,
      y: topY - labelSize - 2,
      size: labelSize,
      font: options.labelFont,
      color: BLACK,
    });
  }

  // Slots. PDF y is up; row 0 is visually at top.
  const gridTop = topY - labelHeight;
  for (let r = 0; r < rows; r += 1) {
    const row = assembly.gridShape[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c += 1) {
      const slot = row[c];
      if (!slot) continue;
      const slotX = startX + c * cellPt;
      const slotY = gridTop - (r + 1) * cellPt;
      drawSlot(page, slot, slotX, slotY, cellPt, options);
    }
  }

  return { width, height: rows * cellPt + labelHeight, cellPt };
}

function drawSlot(
  page: PDFPage,
  slot: AssemblySlot,
  x: number,
  y: number,
  cellPt: number,
  options: AssemblyRenderOptions,
): void {
  if (slot.kind === "blank") return;
  const showAnswer = options.showAnswerKey ?? false;
  const answerKeyMode = options.answerKeyMode ?? "pre-pasted";

  // Slot background + border.
  page.drawRectangle({
    x,
    y,
    width: cellPt,
    height: cellPt,
    color: PASTE_BG,
    borderColor: SLOT_BORDER,
    borderWidth: 0.6,
  });

  if (slot.kind === "decorative") {
    const sprite = options.spriteResolver?.(slot.item);
    if (sprite) {
      drawSpriteCentered(page, sprite, x, y, cellPt);
    }
    return;
  }

  // kind === "paste"
  if (showAnswer && answerKeyMode === "pre-pasted") {
    const sprite = options.spriteResolver?.(slot.answerItem);
    if (sprite) {
      drawSpriteCentered(page, sprite, x, y, cellPt);
    }
  }
  // child copy (or blank answer key) → leave the slot empty
}

function drawSpriteCentered(
  page: PDFPage,
  sprite: PDFImage,
  x: number,
  y: number,
  cellPt: number,
): void {
  const margin = 2;
  const inner = cellPt - margin * 2;
  const ratio = sprite.width / sprite.height;
  let drawW = inner;
  let drawH = inner;
  if (ratio > 1) drawH = inner / ratio;
  else if (ratio < 1) drawW = inner * ratio;
  const dx = x + (cellPt - drawW) / 2;
  const dy = y + (cellPt - drawH) / 2;
  page.drawImage(sprite, { x: dx, y: dy, width: drawW, height: drawH });
}

export interface CutoutStripRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CutoutStripOptions {
  cutoutSize: CutoutSize;
  spriteResolver?: SpriteResolver;
  /** Strip flow: vertical column (default) or horizontal row. */
  flow?: "vertical" | "horizontal";
  /** Gap between cutouts in PDF points. */
  gapPt?: number;
}

/**
 * Render the cutout strip — a sequence of black-bordered cuttable squares
 * (one per CutoutSpec entry, repeated `count` times).
 */
export function renderCutoutStrip(
  page: PDFPage,
  cutouts: CutoutSpec[],
  rect: CutoutStripRect,
  options: CutoutStripOptions,
): { width: number; height: number; itemsRendered: number } {
  const cellPt = CUTOUT_SIZE_PT[options.cutoutSize];
  const gap = options.gapPt ?? 4;
  const flow = options.flow ?? "vertical";
  const flat: string[] = [];
  for (const c of cutouts) {
    for (let i = 0; i < c.count; i += 1) flat.push(c.item);
  }

  // For vertical flow, lay out single column centered horizontally.
  if (flow === "vertical") {
    const startX = rect.x + (rect.width - cellPt) / 2;
    let y = rect.y + rect.height - cellPt;
    let drawn = 0;
    for (const itemRef of flat) {
      if (y < rect.y) break;
      drawCutout(page, itemRef, startX, y, cellPt, options.spriteResolver);
      y -= cellPt + gap;
      drawn += 1;
    }
    return { width: cellPt, height: drawn * (cellPt + gap), itemsRendered: drawn };
  }

  // Horizontal flow: lay out from top-left, wrapping rows.
  const cols = Math.max(1, Math.floor((rect.width + gap) / (cellPt + gap)));
  let drawn = 0;
  for (let i = 0; i < flat.length; i += 1) {
    const itemRef = flat[i];
    if (!itemRef) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = rect.x + c * (cellPt + gap);
    const yTop = rect.y + rect.height - (r + 1) * (cellPt + gap);
    if (yTop < rect.y) break;
    drawCutout(page, itemRef, x, yTop, cellPt, options.spriteResolver);
    drawn += 1;
  }
  const rowsUsed = Math.ceil(drawn / cols);
  return {
    width: cols * (cellPt + gap) - gap,
    height: rowsUsed * (cellPt + gap) - gap,
    itemsRendered: drawn,
  };
}

function drawCutout(
  page: PDFPage,
  itemRef: string,
  x: number,
  y: number,
  cellPt: number,
  spriteResolver?: SpriteResolver,
): void {
  page.drawRectangle({
    x,
    y,
    width: cellPt,
    height: cellPt,
    color: pdfRgb(1, 1, 1),
    borderColor: BLACK,
    borderWidth: CUTOUT_BORDER_PT,
  });
  const sprite = spriteResolver?.(itemRef);
  if (sprite) drawSpriteCentered(page, sprite, x, y, cellPt);
}

/** Helper to embed Helvetica-Bold given a PDFDocument has been opened by the
 * caller. Most callers will hand a font in via options.labelFont; this is here
 * for convenience when building a one-off test page. */
export const ASSEMBLY_LABEL_FONT_NAME = StandardFonts.HelveticaBold;
