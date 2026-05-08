import { GRID_N, type PaletteEntry, type RGB } from "@/lib/palette";
import {
  PAGE_H,
  PAGE_W,
  drawFooter,
  drawGrid,
  drawText,
  drawTitle,
  type PdfContext,
} from "@/lib/pdf/grid";
import { drawKeyEntry, wrapCoordsToWidth } from "@/lib/pdf/keyEntry";

export function renderReferencePage(
  ctx: PdfContext,
  itemLabel: string,
  palette: PaletteEntry[],
): void {
  drawTitle(ctx, `${itemLabel} (Hard) \u2014 Reference`);

  const fills = new Map<string, RGB>();
  for (const entry of palette) {
    for (const cell of entry.cells) {
      fills.set(cell, entry.rgb);
    }
  }

  const cell = 16.0;
  const gridW = GRID_N * cell;
  const gx = 60;
  const gy = PAGE_H - 100;
  drawGrid(ctx, { gx, gy, cell, fills, labelSize: 8.0 });

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

  drawFooter(
    ctx,
    "Hard key: for each color, the listed cells should be filled with that color.",
  );
}
