import { GRID_N, type PaletteEntry } from "@/lib/palette";
import {
  PAGE_H,
  PAGE_W,
  centerText,
  drawFooter,
  drawGrid,
  drawLine,
  drawText,
  drawTitle,
  strokeRectangle,
  type PdfContext,
} from "@/lib/pdf/grid";
import { drawKeyEntry, wrapCoordsToWidth } from "@/lib/pdf/keyEntry";

export function renderCoordinatePage(
  ctx: PdfContext,
  itemLabel: string,
  palette: PaletteEntry[],
): void {
  drawTitle(ctx, `${itemLabel} (Coordinate Coloring)`);

  const cell = 16.0;
  const gridW = GRID_N * cell;
  const gx = 60;
  const gy = PAGE_H - 100;
  drawGrid(ctx, { gx, gy, cell, labelSize: 8.0 });

  const swatchSize = 20.0;
  const textIndent = 8.0;
  const keyX = gx + gridW + 24;
  const rightMargin = 36;
  const keyTextMaxW = PAGE_W - keyX - swatchSize - textIndent - rightMargin;

  drawText(ctx, "Coordinate Coloring Key", keyX, gy + 2, ctx.fonts.bold, 11);

  let cy = gy - 14;
  const interGap = 6.0;
  for (const entry of palette) {
    const wrapped = wrapCoordsToWidth(ctx, entry.cells, keyTextMaxW);
    cy =
      drawKeyEntry(ctx, keyX, cy, entry.rgb, wrapped, {
        swatchSize,
        textIndent,
      }) - interGap;
  }

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
    "Hard: each cell label is column letter (A-P) + row letter (a-p), e.g. 'Dk' = column D, row k.",
  );
}
