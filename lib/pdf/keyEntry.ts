import { type PDFFont } from "pdf-lib";
import { type RGB } from "@/lib/palette";
import {
  drawSwatch,
  drawText,
  textWidth,
  type PdfContext,
} from "@/lib/pdf/grid";

export function wrapCoordsToWidth(
  ctx: PdfContext,
  coords: string[],
  maxWidth: number,
  font: PDFFont = ctx.fonts.regular,
  fontSize = 9.0,
): string[] {
  const lines: string[] = [];
  let current = "";

  for (const coord of coords) {
    const trial = current ? `${current}, ${coord}` : coord;
    if (current && textWidth(trial, font, fontSize) > maxWidth) {
      lines.push(current);
      current = coord;
    } else {
      current = trial;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

export function drawKeyEntry(
  ctx: PdfContext,
  x: number,
  yTop: number,
  color: RGB,
  coordLines: string[],
  options: {
    swatchSize?: number;
    textIndent?: number;
    lineH?: number;
    fontSize?: number;
    font?: PDFFont;
  } = {},
): number {
  const swatchSize = options.swatchSize ?? 20.0;
  const textIndent = options.textIndent ?? 8.0;
  const lineH = options.lineH ?? 11.5;
  const fontSize = options.fontSize ?? 9.0;
  const font = options.font ?? ctx.fonts.regular;
  const nLines = Math.max(1, coordLines.length);
  const textBlockH = nLines * lineH;
  const blockH = Math.max(swatchSize, textBlockH);

  const swatchYBottom = yTop - (blockH + swatchSize) / 2;
  drawSwatch(ctx, x, swatchYBottom, swatchSize, color);

  const textX = x + swatchSize + textIndent;
  const textBlockTop = yTop - (blockH - textBlockH) / 2;
  const firstBaseline = textBlockTop - fontSize - 1;

  coordLines.forEach((line, index) => {
    drawText(ctx, line, textX, firstBaseline - index * lineH, font, fontSize);
  });

  return yTop - blockH;
}
