// Browser-side maze-hunt PDF builder. v1 (Epic 1) renders a single Letter
// portrait page with a centered maze + footer (theme label, seed, date).
//
// Subsequent epics layer collectibles (Epic 2), assembly target + cutouts
// (Epic 2), and the two-up child + answer layout (Epic 3) on top of this.

import { PDFDocument, StandardFonts, rgb as pdfRgb } from "pdf-lib";
import type { MazeGrid } from "@/lib/maze";
import { renderMaze } from "@/lib/pdf/maze";

export const PAGE_W = 612;
export const PAGE_H = 792;

export interface BuildMazePdfOptions {
  grid: MazeGrid;
  /** Free-text title above the maze (e.g. "End Island"). */
  title?: string;
  /** Tag rendered in the footer along with the seed and date. */
  themeLabel?: string;
  /** Render the answer-key solution path. Default false. */
  showSolutionPath?: boolean;
  /** B&W safe path style (dashed black, no red). Default false. */
  blackAndWhiteSafe?: boolean;
}

export async function buildMazeHuntPdf(
  options: BuildMazePdfOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const titleText = options.title ?? "Maze Hunt";
  pdfDoc.setTitle(`${titleText} - Maze Hunt`);
  pdfDoc.setAuthor("Davis Puzzle Generator");
  pdfDoc.setSubject(`Maze seed: ${options.grid.seed}`);

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  // Title.
  page.drawText(titleText, {
    x: 54,
    y: PAGE_H - 56,
    size: 22,
    font: helveticaBold,
    color: pdfRgb(0, 0, 0),
  });

  // Maze region: centered, leaving room for title + footer.
  const marginX = 54;
  const topY = PAGE_H - 90;
  const bottomY = 80;
  const mazeRect = {
    x: marginX,
    y: bottomY,
    width: PAGE_W - marginX * 2,
    height: topY - bottomY,
  };
  renderMaze(page, options.grid, mazeRect, {
    showSolutionPath: options.showSolutionPath ?? false,
    blackAndWhiteSafe: options.blackAndWhiteSafe ?? false,
  });

  // Footer.
  const footerParts = [
    options.themeLabel ?? "",
    `seed: ${options.grid.seed}`,
    new Date().toISOString().slice(0, 10),
  ].filter((s) => s.length > 0);
  const footer = footerParts.join("  ·  ");
  page.drawText(footer, {
    x: 54,
    y: 40,
    size: 8,
    font: helveticaOblique,
    color: pdfRgb(0.45, 0.45, 0.45),
  });
  // Re-use Helvetica reference to silence unused-import lint warnings.
  if (helvetica.name === "") void helvetica;

  return pdfDoc.save();
}
