import {
  type PDFFont,
  type PDFPage,
  rgb as pdfRgb,
} from "pdf-lib";
import {
  COLUMNS,
  GRID_N,
  ROWS,
  cellLabelToPoint,
  type RGB,
} from "@/lib/palette";

export const PAGE_W = 612;
export const PAGE_H = 792;

export interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
}

export interface PdfContext {
  page: PDFPage;
  fonts: PdfFonts;
}

export interface GridOptions {
  gx: number;
  gy: number;
  cell: number;
  fills?: Map<string, RGB>;
  numbers?: Map<string, number>;
  showLabels?: boolean;
  labelSize?: number;
  lineWidth?: number;
}

const BLACK = pdfRgb(0, 0, 0);

export function drawGrid(ctx: PdfContext, options: GridOptions): void {
  const {
    gx,
    gy,
    cell,
    fills,
    numbers,
    showLabels = true,
    labelSize = 8.0,
    lineWidth = 0.5,
  } = options;
  const gridW = GRID_N * cell;
  const bottom = gy - gridW;

  if (fills) {
    for (const [label, color] of fills) {
      const { x, y } = cellLabelToPoint(label);
      ctx.page.drawRectangle({
        x: gx + x * cell,
        y: gy - (y + 1) * cell,
        width: cell,
        height: cell,
        color: fillColor(color),
      });
    }
  }

  for (let i = 0; i <= GRID_N; i += 1) {
    ctx.page.drawLine({
      start: { x: gx + i * cell, y: bottom },
      end: { x: gx + i * cell, y: gy },
      color: BLACK,
      thickness: lineWidth,
    });
    ctx.page.drawLine({
      start: { x: gx, y: bottom + i * cell },
      end: { x: gx + gridW, y: bottom + i * cell },
      color: BLACK,
      thickness: lineWidth,
    });
  }

  if (numbers) {
    const fontSize = Math.max(6.0, cell * 0.55);
    for (const [label, value] of numbers) {
      const { x, y } = cellLabelToPoint(label);
      centerText(
        ctx,
        String(value),
        gx + (x + 0.5) * cell,
        gy - (y + 0.75) * cell,
        ctx.fonts.regular,
        fontSize,
      );
    }
  }

  if (showLabels) {
    for (let x = 0; x < GRID_N; x += 1) {
      centerText(
        ctx,
        COLUMNS[x],
        gx + (x + 0.5) * cell,
        gy + 2,
        ctx.fonts.bold,
        labelSize,
      );
    }

    for (let y = 0; y < GRID_N; y += 1) {
      rightText(
        ctx,
        ROWS[y],
        gx - 2,
        gy - (y + 0.75) * cell,
        ctx.fonts.bold,
        labelSize,
      );
    }
  }
}

export function drawSwatch(
  ctx: PdfContext,
  x: number,
  y: number,
  size: number,
  color: RGB,
): void {
  ctx.page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    color: fillColor(color),
    borderColor: BLACK,
    borderWidth: 0.4,
  });
}

export function drawTitle(ctx: PdfContext, text: string, size = 22.0): void {
  drawText(ctx, text, 54, PAGE_H - 56, ctx.fonts.bold, size);
}

export function drawFooter(ctx: PdfContext, text: string): void {
  ctx.page.drawText(text, {
    x: 54,
    y: 28,
    size: 8,
    font: ctx.fonts.oblique,
    color: pdfRgb(0.45, 0.45, 0.45),
  });
}

export function drawText(
  ctx: PdfContext,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
): void {
  ctx.page.drawText(text, {
    x,
    y,
    size,
    font,
    color: BLACK,
  });
}

export function centerText(
  ctx: PdfContext,
  text: string,
  centerX: number,
  y: number,
  font: PDFFont,
  size: number,
): void {
  drawText(ctx, text, centerX - textWidth(text, font, size) / 2, y, font, size);
}

export function rightText(
  ctx: PdfContext,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
): void {
  drawText(ctx, text, rightX - textWidth(text, font, size), y, font, size);
}

export function strokeRectangle(
  ctx: PdfContext,
  x: number,
  y: number,
  width: number,
  height: number,
  borderWidth: number,
): void {
  ctx.page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: BLACK,
    borderWidth,
  });
}

export function drawLine(
  ctx: PdfContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
): void {
  ctx.page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    color: BLACK,
    thickness,
  });
}

export function textWidth(text: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function fillColor(color: RGB) {
  return pdfRgb(color[0] / 255, color[1] / 255, color[2] / 255);
}
