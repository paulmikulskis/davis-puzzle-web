// Two-up Letter portrait orchestrator for the Maze Hunt worksheet.
//
// Default: a single Letter page with the child copy on the top half
// (y 396..792) and the facilitator answer copy on the bottom half (y 0..396),
// separated by a thin horizontal mid-rule.
// Optional: `splitOntoTwoPages: true` emits two Letter pages instead — page 1
// = child copy full-page, page 2 = answer copy full-page.
//
// Per plan.md §3.4 (print module specs) and Feature 7 spec
// (planning/maze-hunts/08-feature-print-layout.md §3 + §4).

import {
  PDFDocument,
  StandardFonts,
  rgb as pdfRgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { MazeGrid, MazeCell } from "@/lib/maze";
import type { Assembly } from "@/lib/assemblies";
import type { Placement } from "@/lib/placement";
import type { Objective } from "@/lib/objectives";
import type { DifficultyPreset } from "@/lib/mazeHuntThemes";
import { drawSpriteAtCell, renderMaze } from "@/lib/pdf/maze";
import {
  CUTOUT_SIZE_PT,
  renderAssemblyTarget,
  renderCutoutStrip,
  type CutoutSize,
} from "@/lib/pdf/assembly";
import { renderChecklist } from "@/lib/pdf/checklist";
import { drawFacilitatorWatermark } from "@/lib/pdf/watermark";

export const PAGE_W = 612;
export const PAGE_H = 792;
export const HALF_H = 396;

// Margins per plan.md §3.4 / Feature 7 §3.1.
const OUTER_MARGIN_X = 36;
const HALF_INNER_TOP_PAD = 16;
const HALF_INNER_BOTTOM_PAD = 24;

// Layout columns within a half (Feature 7 §3.2).
const LEFT_COL_X = 36;
const LEFT_COL_W = 320;
const COL_GUTTER = 16;
const RIGHT_COL_X = LEFT_COL_X + LEFT_COL_W + COL_GUTTER; // 372
const RIGHT_COL_W = PAGE_W - OUTER_MARGIN_X - RIGHT_COL_X; // 204

// Header band height inside a half.
const HEADER_BAND_H = 32;

// Stacking inside the left column: checklist on top, maze below.
// Checklist height accommodates up to ~5 logical objectives, each potentially
// wrapping to 2 visual lines at 9pt + ~4pt leading. The Ocean Monument
// state-change craft sentence is the long-line stress test.
const CHECKLIST_BLOCK_H = 90;

// Stacking inside the right column: assembly on top, cutouts below.
const ASSEMBLY_BLOCK_H = 180;
const CUTOUT_BLOCK_H = 132;

const MID_RULE_THICKNESS = 0.4;
const MID_RULE_COLOR = pdfRgb(0.4, 0.4, 0.4);
const FOOTER_GRAY = pdfRgb(0.45, 0.45, 0.45);
const HEADER_GRAY = pdfRgb(0.35, 0.35, 0.35);
const NAME_LINE_COLOR = pdfRgb(0.5, 0.5, 0.5);

export interface BuildMazeHuntPdfOptions {
  grid: MazeGrid;
  theme: {
    id: string;
    displayName: string;
  };
  /** Difficulty preset, used in the footer descriptor. */
  difficulty: DifficultyPreset;
  /** Flat collectible list (for sprite stamping). */
  collectibles: Placement[];
  /** Grouped collectibles for the "Objectives: N" header / future rendering. */
  placementsByItem: Record<string, Placement[]>;
  /** Optional boss sprite stamped on the maze center. */
  boss?: { cell: MazeCell; itemRef: string };
  /** Optional assembly + cutouts on the right column. */
  assembly?: Assembly;
  /** Cutout size preset. */
  cutoutSize: CutoutSize;
  /** Pre-fetched PNG bytes for every itemRef this worksheet needs. */
  spriteBytes: Record<string, Uint8Array>;
  /** Pre-composed objectives (Andrew already overrode lines if any). */
  objectives: Objective[];
  /** B&W safe path style (dashed black, no red). Default false. */
  blackAndWhiteSafe?: boolean;
  /** Two-page output (child copy on page 1, answer copy on page 2). Default false. */
  splitOntoTwoPages?: boolean;
  /** Free-text session label appended to footer. Default empty. */
  sessionLabel?: string;
}

interface PageFonts {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
}

interface SpriteRegistry {
  byRef: Record<string, PDFImage>;
  resolve: (itemRef: string) => PDFImage | undefined;
}

interface HalfFrameInputs {
  showSolutionPath: boolean;
  showAssemblyAnswerKey: boolean;
  drawWatermark: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildMazeHuntPdf(
  options: BuildMazeHuntPdfOptions,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`${options.theme.displayName} - Maze Hunt`);
  pdfDoc.setAuthor("Davis Puzzle Generator");
  pdfDoc.setSubject(
    `Maze Hunt: ${options.theme.displayName}, ${options.difficulty}, seed ${options.grid.seed}`,
  );

  const fonts: PageFonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
  };

  const sprites = await embedSprites(pdfDoc, options.spriteBytes);

  if (options.splitOntoTwoPages === true) {
    // Page 1 — child copy filling the page top half (mirrored to top half of
    // a one-page layout, but on its own page; bottom half is reserved blank
    // for tear-off space).
    // Split mode: each page is a full-page version of the same half-frame
    // layout. The footer carries theme + difficulty + page number so we don't
    // need a separate title row that fights for space with the checklist.
    const page1 = pdfDoc.addPage([PAGE_W, PAGE_H]);
    renderHalfFrame(page1, fonts, sprites, options, /* yOffset */ HALF_H, {
      showSolutionPath: false,
      showAssemblyAnswerKey: false,
      drawWatermark: false,
    });
    drawFooter(page1, fonts, options, "1 of 2");

    const page2 = pdfDoc.addPage([PAGE_W, PAGE_H]);
    renderHalfFrame(page2, fonts, sprites, options, /* yOffset */ HALF_H, {
      showSolutionPath: true,
      showAssemblyAnswerKey: true,
      drawWatermark: true,
    });
    drawFooter(page2, fonts, options, "2 of 2");
  } else {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    // The two-up layout is tight on vertical space; the theme name lives in
    // the footer descriptor instead of a separate title at the top.

    // Top half = child copy (yOffset = HALF_H places the half at y 396..792).
    renderHalfFrame(page, fonts, sprites, options, /* yOffset */ HALF_H, {
      showSolutionPath: false,
      showAssemblyAnswerKey: false,
      drawWatermark: false,
    });

    // Mid-rule.
    page.drawLine({
      start: { x: OUTER_MARGIN_X, y: HALF_H },
      end: { x: PAGE_W - OUTER_MARGIN_X, y: HALF_H },
      thickness: MID_RULE_THICKNESS,
      color: MID_RULE_COLOR,
    });

    // Bottom half = answer copy (yOffset = 0).
    renderHalfFrame(page, fonts, sprites, options, /* yOffset */ 0, {
      showSolutionPath: true,
      showAssemblyAnswerKey: true,
      drawWatermark: true,
    });

    drawFooter(page, fonts, options);
  }

  return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

async function embedSprites(
  pdfDoc: PDFDocument,
  bytesByRef: Record<string, Uint8Array>,
): Promise<SpriteRegistry> {
  const byRef: Record<string, PDFImage> = {};
  for (const [key, bytes] of Object.entries(bytesByRef)) {
    try {
      byRef[key] = await pdfDoc.embedPng(bytes);
    } catch {
      // Skip silently — caller may have included optional sprites that don't
      // decode. Slot will render without an icon.
    }
  }
  return {
    byRef,
    resolve(itemRef: string): PDFImage | undefined {
      return byRef[itemRef];
    },
  };
}

// ---------------------------------------------------------------------------
// Half-frame renderer
// ---------------------------------------------------------------------------

function renderHalfFrame(
  page: PDFPage,
  fonts: PageFonts,
  sprites: SpriteRegistry,
  options: BuildMazeHuntPdfOptions,
  yOffset: number,
  flags: HalfFrameInputs,
): void {
  // Half occupies y in [yOffset, yOffset + HALF_H].
  // Header band sits at the top of the half; body band fills the rest.
  const halfTop = yOffset + HALF_H - HALF_INNER_TOP_PAD;
  const halfBottom = yOffset + HALF_INNER_BOTTOM_PAD;

  // ----- Header band -----
  const headerBaseY = halfTop - HEADER_BAND_H;
  drawHeaderBand(page, fonts, options, yOffset, headerBaseY);

  // ----- Body band -----
  const bodyTop = headerBaseY - 4; // small breathing gap below the header
  const bodyBottom = halfBottom;

  // Left column: checklist on top, maze fills the rest.
  const checklistRect = {
    x: LEFT_COL_X,
    y: bodyTop - CHECKLIST_BLOCK_H,
    width: LEFT_COL_W,
    height: CHECKLIST_BLOCK_H,
  };
  renderChecklist(page, options.objectives, checklistRect, {
    bold: fonts.bold,
    regular: fonts.regular,
    fontSize: 9,
    showMismatchBadge: true,
  });

  const mazeRect = {
    x: LEFT_COL_X,
    y: bodyBottom,
    width: LEFT_COL_W,
    height: checklistRect.y - 6 - bodyBottom,
  };
  if (mazeRect.height > 40) {
    const { metrics } = renderMaze(page, options.grid, mazeRect, {
      showSolutionPath: flags.showSolutionPath,
      blackAndWhiteSafe: options.blackAndWhiteSafe ?? false,
    });

    // Stamp collectibles + boss inside the maze.
    for (const p of options.collectibles) {
      const sprite = sprites.resolve(p.itemRef);
      if (!sprite) continue;
      drawSpriteAtCell(page, sprite, p.cell, metrics, options.grid.cellsDown);
    }
    if (options.boss) {
      const sprite = sprites.resolve(options.boss.itemRef);
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
  }

  // Right column: assembly target on top, cutouts below.
  if (options.assembly) {
    const assembly = options.assembly;
    const assemblyRect = {
      x: RIGHT_COL_X,
      y: bodyTop - ASSEMBLY_BLOCK_H,
      width: RIGHT_COL_W,
      height: ASSEMBLY_BLOCK_H,
    };
    renderAssemblyTarget(page, assembly, assemblyRect, {
      cutoutSize: options.cutoutSize,
      showAnswerKey: flags.showAssemblyAnswerKey,
      answerKeyMode: assembly.answerKeyDefault,
      spriteResolver: sprites.resolve,
      labelFont: fonts.bold,
    });

    const cutoutsRect = {
      x: RIGHT_COL_X,
      y: bodyBottom,
      width: RIGHT_COL_W,
      height: Math.max(
        0,
        assemblyRect.y - 8 - bodyBottom,
      ),
    };
    const cellPt = CUTOUT_SIZE_PT[options.cutoutSize];
    if (cutoutsRect.height > cellPt + 4) {
      const heading = "Cutouts";
      const headingSize = 9;
      page.drawText(heading, {
        x:
          RIGHT_COL_X +
          (RIGHT_COL_W -
            fonts.bold.widthOfTextAtSize(heading, headingSize)) /
            2,
        y: cutoutsRect.y + Math.min(CUTOUT_BLOCK_H, cutoutsRect.height) - 10,
        size: headingSize,
        font: fonts.bold,
        color: HEADER_GRAY,
      });
      const stripRect = {
        x: cutoutsRect.x,
        y: cutoutsRect.y,
        width: cutoutsRect.width,
        height: cutoutsRect.height - 14,
      };
      renderCutoutStrip(page, assembly.cutoutPanel, stripRect, {
        cutoutSize: options.cutoutSize,
        spriteResolver: sprites.resolve,
        flow: "horizontal",
      });
    }
  }

  // ----- Watermark on the answer half -----
  if (flags.drawWatermark) {
    drawFacilitatorWatermark(
      page,
      {
        x: OUTER_MARGIN_X,
        y: yOffset + HALF_INNER_BOTTOM_PAD,
        width: PAGE_W - OUTER_MARGIN_X * 2,
        height: HALF_H - HALF_INNER_TOP_PAD - HALF_INNER_BOTTOM_PAD,
      },
      {
        font: fonts.bold,
        size: 48,
        opacity: 0.15,
        rotateDegrees: -30,
      },
    );
  }
}

function drawHeaderBand(
  page: PDFPage,
  fonts: PageFonts,
  options: BuildMazeHuntPdfOptions,
  yOffset: number,
  headerBaseY: number,
): void {
  // Objectives badge: top-left.
  const badgeText = `Objectives: ${options.objectives.length}`;
  const badgeSize = 9;
  page.drawText(badgeText, {
    x: LEFT_COL_X,
    y: headerBaseY + HEADER_BAND_H - badgeSize - 2,
    size: badgeSize,
    font: fonts.bold,
    color: HEADER_GRAY,
  });

  // Name line: top-right. Underline at the same baseline as the badge text.
  const nameLabel = "Name";
  const nameLabelSize = 8;
  const nameLineY = headerBaseY + HEADER_BAND_H - 12;
  const nameLineX1 = RIGHT_COL_X;
  const nameLineX2 = PAGE_W - OUTER_MARGIN_X;
  page.drawLine({
    start: { x: nameLineX1, y: nameLineY },
    end: { x: nameLineX2, y: nameLineY },
    thickness: 0.5,
    color: NAME_LINE_COLOR,
  });
  page.drawText(nameLabel, {
    x: nameLineX1,
    y: nameLineY - nameLabelSize - 2,
    size: nameLabelSize,
    font: fonts.regular,
    color: HEADER_GRAY,
  });
  // Avoid unused-variable warnings if oblique isn't otherwise referenced
  // inside this function path.
  void yOffset;
}

function drawFooter(
  page: PDFPage,
  fonts: PageFonts,
  options: BuildMazeHuntPdfOptions,
  pageNumber?: string,
): void {
  const sizeDescriptor = sizeDescriptorFor(options.grid);
  const cutoutDescriptor = cutoutDescriptorFor(options.cutoutSize);
  const date = new Date().toISOString().slice(0, 10);
  const parts = [
    `Maze Hunt - ${options.theme.displayName}`,
    `Maze: ${sizeDescriptor} / Cutouts: ${cutoutDescriptor} / Objectives: ${options.objectives.length}`,
    date,
  ];
  if (options.sessionLabel && options.sessionLabel.trim().length > 0) {
    parts.push(options.sessionLabel.trim());
  }
  if (pageNumber) parts.push(`Page ${pageNumber}`);
  const footer = parts.join(" - ");
  page.drawText(footer, {
    x: OUTER_MARGIN_X,
    y: 28,
    size: 8,
    font: fonts.oblique,
    color: FOOTER_GRAY,
  });
}

// Rough S/M/L mapping from the live grid dimensions. Mirrors the preset table
// in lib/maze.ts and keeps the footer descriptor matching what Andrew picked
// in the editor.
function sizeDescriptorFor(grid: MazeGrid): "S" | "M" | "L" {
  const dim = Math.max(grid.cellsAcross, grid.cellsDown);
  if (dim <= 14) return "S";
  if (dim <= 18) return "M";
  return "L";
}

function cutoutDescriptorFor(cutoutSize: CutoutSize): "S" | "M" | "L" {
  if (cutoutSize === "small") return "S";
  if (cutoutSize === "large") return "L";
  return "M";
}
