// Browser-side maze-hunt PDF builder.
//
// Epic 1 shipped: single-page Letter, maze-only.
// Epic 2 (this revision): adds collectible sprite stamping inside the maze,
// the assembly target panel on the right, and the cutout strip below the
// assembly. Single Letter portrait page (top-half worksheet); the bottom-half
// answer key + objective list lands in Epic 3.

import {
  PDFDocument,
  StandardFonts,
  rgb as pdfRgb,
  type PDFImage,
} from "pdf-lib";
import type { MazeGrid } from "@/lib/maze";
import type { Assembly } from "@/lib/assemblies";
import type { Placement } from "@/lib/placement";
import { drawSpriteAtCell, renderMaze } from "@/lib/pdf/maze";
import {
  CUTOUT_SIZE_PT,
  renderAssemblyTarget,
  renderCutoutStrip,
  type CutoutSize,
} from "@/lib/pdf/assembly";

export const PAGE_W = 612;
export const PAGE_H = 792;

export interface BuildMazeHuntPdfOptions {
  grid: MazeGrid;
  /** Free-text title above the maze (e.g. "End Island"). */
  title?: string;
  /** Tag rendered in the footer along with the seed and date. */
  themeLabel?: string;
  /** Render the answer-key solution path. Default false. */
  showSolutionPath?: boolean;
  /** B&W safe path style (dashed black, no red). Default false. */
  blackAndWhiteSafe?: boolean;
  /** Collectibles to stamp inside the maze (Epic 2). */
  collectibles?: Placement[];
  /** Optional boss sprite stamped on the maze center. */
  boss?: { cell: { x: number; y: number }; itemRef: string };
  /** Optional assembly + cutouts to render on the right of the page. */
  assembly?: Assembly;
  /** Cutout size preset. Default "medium". */
  cutoutSize?: CutoutSize;
  /** Show the answer-key state for the assembly (pre-pasted slots). */
  showAssemblyAnswerKey?: boolean;
  /**
   * Map of catalog canonicalName → PNG byte source for sprite stamping.
   * Caller fetches /items/<filename> / /blocks/<filename> / /entities/<filename>
   * and passes the bytes here. Pass an empty map (or omit) to skip stamping
   * entirely — useful for Epic 1 maze-only fallback.
   */
  spriteBytes?: Record<string, Uint8Array>;
}

export async function buildMazeHuntPdf(
  options: BuildMazeHuntPdfOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const titleText = options.title ?? "Maze Hunt";
  pdfDoc.setTitle(`${titleText} - Maze Hunt`);
  pdfDoc.setAuthor("Davis Puzzle Generator");
  pdfDoc.setSubject(`Maze seed: ${options.grid.seed}`);

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Embed all sprite bytes once up-front.
  const sprites: Record<string, PDFImage> = {};
  if (options.spriteBytes) {
    for (const [key, bytes] of Object.entries(options.spriteBytes)) {
      try {
        sprites[key] = await pdfDoc.embedPng(bytes);
      } catch {
        // Skip silently — caller may have included optional sprites that
        // don't decode. Slot will render without an icon.
      }
    }
  }
  const spriteResolver = (itemRef: string): PDFImage | undefined =>
    sprites[itemRef];

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  // Title.
  page.drawText(titleText, {
    x: 54,
    y: PAGE_H - 56,
    size: 22,
    font: helveticaBold,
    color: pdfRgb(0, 0, 0),
  });

  // Layout: maze on the left ~70% of width, assembly/cutout column on the right.
  const marginX = 36;
  const marginTop = PAGE_H - 90;
  const marginBottom = 80;
  const totalWidth = PAGE_W - marginX * 2;
  const totalHeight = marginTop - marginBottom;

  const hasRightPanel = options.assembly !== undefined;
  const rightPanelWidth = hasRightPanel ? 200 : 0;
  const gutter = hasRightPanel ? 16 : 0;
  const mazeWidth = totalWidth - rightPanelWidth - gutter;
  const mazeRect = {
    x: marginX,
    y: marginBottom,
    width: mazeWidth,
    height: totalHeight,
  };

  const { metrics } = renderMaze(page, options.grid, mazeRect, {
    showSolutionPath: options.showSolutionPath ?? false,
    blackAndWhiteSafe: options.blackAndWhiteSafe ?? false,
  });

  // Stamp collectibles + boss inside the maze.
  if (options.collectibles) {
    for (const p of options.collectibles) {
      const sprite = sprites[p.itemRef];
      if (!sprite) continue;
      drawSpriteAtCell(page, sprite, p.cell, metrics, options.grid.cellsDown);
    }
  }
  if (options.boss) {
    const sprite = sprites[options.boss.itemRef];
    if (sprite) {
      drawSpriteAtCell(
        page,
        sprite,
        options.boss.cell,
        metrics,
        options.grid.cellsDown,
        1.4,
      );
    }
  }

  // Right panel: assembly target on top, cutouts below.
  if (hasRightPanel && options.assembly) {
    const rightX = marginX + mazeWidth + gutter;
    const cutoutSize: CutoutSize = options.cutoutSize ?? "medium";
    const cellPt = CUTOUT_SIZE_PT[cutoutSize];
    const assemblyHeight = options.assembly.gridShape.length * cellPt + 28;
    const assemblyRect = {
      x: rightX,
      y: marginBottom + totalHeight - assemblyHeight,
      width: rightPanelWidth,
      height: assemblyHeight,
    };
    renderAssemblyTarget(page, options.assembly, assemblyRect, {
      cutoutSize,
      showAnswerKey: options.showAssemblyAnswerKey ?? false,
      answerKeyMode: options.assembly.answerKeyDefault,
      spriteResolver,
      labelFont: helveticaBold,
    });

    const cutoutsRect = {
      x: rightX,
      y: marginBottom + 24,
      width: rightPanelWidth,
      height: assemblyRect.y - (marginBottom + 24) - 8,
    };
    if (cutoutsRect.height > cellPt + 4) {
      // Section heading.
      const heading = "Cutouts";
      const headingSize = 9;
      page.drawText(heading, {
        x: rightX + (rightPanelWidth - helveticaBold.widthOfTextAtSize(heading, headingSize)) / 2,
        y: cutoutsRect.y + cutoutsRect.height + 2,
        size: headingSize,
        font: helveticaBold,
        color: pdfRgb(0.25, 0.25, 0.25),
      });
      renderCutoutStrip(page, options.assembly.cutoutPanel, cutoutsRect, {
        cutoutSize,
        spriteResolver,
        flow: "vertical",
      });
    }
  }

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
  if (helvetica.name === "") void helvetica;

  return pdfDoc.save();
}
