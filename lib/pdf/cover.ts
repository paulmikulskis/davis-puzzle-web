import { GRID_N } from "@/lib/palette";
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
  textWidth,
  type PdfContext,
} from "@/lib/pdf/grid";

export function renderCoverPage(ctx: PdfContext, itemLabel: string): void {
  drawTitle(ctx, "Minecraft Pixel Art Puzzles");

  const cell = 17.0;
  const gridW = GRID_N * cell;
  const gx = 60;
  const gy = PAGE_H - 110;
  drawGrid(ctx, { gx, gy, cell, labelSize: 8.0 });

  const rightColW = 220.0;
  const rx = gx + gridW + 24;
  const ry = gy;
  strokeRectangle(ctx, rx, ry - 22, rightColW, 22, 0.7);
  centerText(ctx, "Name", rx + rightColW / 2, ry - 36, ctx.fonts.bold, 9);

  const prompts = [
    "Based on the pixel colors, I think the image is",
    "Now that I filled in half, I think the image is",
    "Now that I filled it all in, the image is",
  ];
  let py = ry - 66;
  for (const prompt of prompts) {
    drawText(ctx, prompt, rx, py, ctx.fonts.bold, 9.5);
    drawLine(ctx, rx, py - 14, rx + rightColW, py - 14, 0.7);
    drawLine(ctx, rx, py - 30, rx + rightColW, py - 30, 0.7);
    py -= 60;
  }

  const workflow: Array<[string, string]> = [
    [
      "1. Coordinate Coloring (Hard)",
      "participant is given the coordinate coloring key and a blank Pixel Art Grid.",
    ],
    [
      "2. Color by Number",
      "facilitator uses simplified key and writes numbers on Pixel Art Grid.",
    ],
    [
      "3. Pasting by Number",
      "facilitator completes and cuts out puzzle tiles prior to session. Provide participants with cut-out tiles and the standard / simplified coloring key.",
    ],
  ];

  let wy = 200;
  for (const [heading, body] of workflow) {
    drawText(ctx, `${heading}:`, 72, wy, ctx.fonts.bold, 10);
    const maxW = PAGE_W - 144;
    const words = body.split(" ");
    let line = "";
    let ly = wy - 14;

    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (textWidth(trial, ctx.fonts.regular, 10) > maxW) {
        drawText(ctx, line, 72, ly, ctx.fonts.regular, 10);
        ly -= 12;
        line = word;
      } else {
        line = trial;
      }
    }

    if (line) {
      drawText(ctx, line, 72, ly, ctx.fonts.regular, 10);
      ly -= 12;
    }
    wy = ly - 8;
  }

  drawFooter(ctx, `Generated worksheet for: ${itemLabel}`);
}
