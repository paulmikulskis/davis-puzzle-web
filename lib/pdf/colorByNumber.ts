import { GRID_N, type PaletteEntry } from "@/lib/palette";
import {
  PAGE_H,
  PAGE_W,
  centerText,
  drawFooter,
  drawGrid,
  drawLine,
  drawSwatch,
  drawText,
  drawTitle,
  strokeRectangle,
  type PdfContext,
} from "@/lib/pdf/grid";

export function renderColorByNumberPage(
  ctx: PdfContext,
  itemLabel: string,
  palette: PaletteEntry[],
): void {
  drawTitle(ctx, `${itemLabel} (Color by Number)`);

  const numbers = new Map<string, number>();
  palette.forEach((entry, index) => {
    for (const cell of entry.cells) {
      numbers.set(cell, index + 1);
    }
  });

  const cell = 21.0;
  const gridW = GRID_N * cell;
  const gx = 60;
  const gy = PAGE_H - 100;
  drawGrid(ctx, { gx, gy, cell, numbers });

  const rx = gx + gridW + 30;
  const swatchSize = 20.0;
  let cy = gy;
  drawText(ctx, "Color Key", rx, cy + 2, ctx.fonts.bold, 11);
  cy -= 18;

  palette.forEach((entry, index) => {
    drawSwatch(ctx, rx, cy - swatchSize, swatchSize, entry.rgb);
    drawText(ctx, String(index + 1), rx + swatchSize + 8, cy - swatchSize + 6, ctx.fonts.bold, 11);
    cy -= swatchSize + 8;
  });

  const bottomY = gy - gridW - 40;
  const nameW = 200.0;
  strokeRectangle(ctx, 60, bottomY - 22, nameW, 22, 0.7);
  centerText(ctx, "Name", 60 + nameW / 2, bottomY - 36, ctx.fonts.bold, 9);

  const prompts = [
    "Based on the pixel colors, I think the image is",
    "Now that I filled in half, I think the image is",
    "Now that I filled it all in, the image is",
  ];
  const px = 290;
  const promptW = PAGE_W - px - 36;
  let py = bottomY;
  for (const prompt of prompts) {
    drawText(ctx, prompt, px, py, ctx.fonts.bold, 9);
    drawLine(ctx, px, py - 14, px + promptW, py - 14, 0.7);
    py -= 32;
  }

  drawFooter(
    ctx,
    "Color by Number: every cell shows a digit; match the digit to the key.",
  );
}
