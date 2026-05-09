// Renders a MazeGrid into a pdf-lib PDFPage as SVG paths.
// One drawSvgPath call per layer (boundary, interior, solution path).
// Coordinates are cell-grid units; the caller passes a transform so the maze
// fits inside the desired page region.

import {
  LineCapStyle,
  rgb as pdfRgb,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { MazeCell, MazeGrid, WallSegment } from "@/lib/maze";

export interface CellSprite {
  cell: MazeCell;
  image: PDFImage;
}

export interface MazeRenderRect {
  /** Bottom-left of the maze region in PDF points. */
  x: number;
  y: number;
  /** Width and height of the maze region in PDF points. */
  width: number;
  height: number;
}

export interface MazeRenderOptions {
  /** Show the answer-key solution path on top of the walls. */
  showSolutionPath?: boolean;
  /** B&W safe: dashed black instead of red 1.5pt for the solution path. */
  blackAndWhiteSafe?: boolean;
  /** Optional override for boundary line weight (default 1.5pt). */
  boundaryStrokeWidth?: number;
  /** Optional override for interior line weight (default 0.75pt). */
  interiorStrokeWidth?: number;
  /** Whether to draw the entry/exit arrows. Default true. */
  drawArrows?: boolean;
}

const BLACK = pdfRgb(0, 0, 0);
const RED = pdfRgb(0.85, 0.16, 0.16);

interface CellMetrics {
  /** Cell side length in PDF points. */
  cell: number;
  /** Origin (lower-left of grid) in PDF points. */
  originX: number;
  originY: number;
  /** Total grid drawing width in PDF points. */
  drawnWidth: number;
  drawnHeight: number;
}

/**
 * Compute the cell size that lets the maze fit inside the given rect, plus
 * the origin offsets that keep it centered. PDF y-up is handled by mapping
 * grid y=0 (top) to (originY + cellsDown * cell) at the top of the rect.
 */
export function computeMazeMetrics(
  grid: MazeGrid,
  rect: MazeRenderRect,
): CellMetrics {
  const cellByWidth = rect.width / grid.cellsAcross;
  const cellByHeight = rect.height / grid.cellsDown;
  const cell = Math.min(cellByWidth, cellByHeight);
  const drawnWidth = cell * grid.cellsAcross;
  const drawnHeight = cell * grid.cellsDown;
  const originX = rect.x + (rect.width - drawnWidth) / 2;
  const originY = rect.y + (rect.height - drawnHeight) / 2;
  return { cell, originX, originY, drawnWidth, drawnHeight };
}

/**
 * Map a wall segment in cell-grid units to SVG-native (Y-down) coordinates
 * relative to the maze top-left. pdf-lib's drawSvgPath flips Y for us.
 */
function wallToSvg(
  seg: WallSegment,
  m: CellMetrics,
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: seg.x1 * m.cell,
    y1: seg.y1 * m.cell,
    x2: seg.x2 * m.cell,
    y2: seg.y2 * m.cell,
  };
}

function cellCenterSvg(
  cell: MazeCell,
  m: CellMetrics,
): { x: number; y: number } {
  return {
    x: (cell.x + 0.5) * m.cell,
    y: (cell.y + 0.5) * m.cell,
  };
}

/** PDF-points x/y origin to pass to drawSvgPath so SVG (0,0) lands at the
 * top-left of the maze region. The internal scale(1,-1) flips Y. */
function svgOrigin(m: CellMetrics, drawnHeight: number): { x: number; y: number } {
  return { x: m.originX, y: m.originY + drawnHeight };
}

function wallsToSvgPath(walls: WallSegment[], m: CellMetrics): string {
  const parts: string[] = [];
  for (const seg of walls) {
    const { x1, y1, x2, y2 } = wallToSvg(seg, m);
    parts.push(`M ${x1.toFixed(3)} ${y1.toFixed(3)} L ${x2.toFixed(3)} ${y2.toFixed(3)}`);
  }
  return parts.join(" ");
}

function solutionPathToSvgPath(path: MazeCell[], m: CellMetrics): string {
  if (path.length === 0) return "";
  const first = path[0];
  if (!first) return "";
  const start = cellCenterSvg(first, m);
  const parts: string[] = [`M ${start.x.toFixed(3)} ${start.y.toFixed(3)}`];
  for (let i = 1; i < path.length; i += 1) {
    const c = path[i];
    if (!c) continue;
    const p = cellCenterSvg(c, m);
    parts.push(`L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
  }
  return parts.join(" ");
}

/**
 * Build a small filled triangle (chevron/arrowhead) SVG path. (x, y) is the
 * anchor in SVG-native coords (Y-down). Direction is in the *visual* sense
 * once the renderer flips Y.
 *
 * Visual mapping (Y-down SVG): "N" = tip points up = smaller y; "S" = tip
 * points down = larger y; "E" = tip points right; "W" = tip points left.
 */
function chevronSvgPath(
  x: number,
  y: number,
  direction: "N" | "S" | "E" | "W",
  size: number,
): string {
  const half = size / 2;
  let p1x = 0;
  let p1y = 0;
  let p2x = 0;
  let p2y = 0;
  let p3x = 0;
  let p3y = 0;
  if (direction === "N") {
    p1x = x; p1y = y - half;
    p2x = x - half; p2y = y + half;
    p3x = x + half; p3y = y + half;
  } else if (direction === "S") {
    p1x = x; p1y = y + half;
    p2x = x - half; p2y = y - half;
    p3x = x + half; p3y = y - half;
  } else if (direction === "E") {
    p1x = x + half; p1y = y;
    p2x = x - half; p2y = y - half;
    p3x = x - half; p3y = y + half;
  } else {
    p1x = x - half; p1y = y;
    p2x = x + half; p2y = y - half;
    p3x = x + half; p3y = y + half;
  }
  return (
    `M ${p1x.toFixed(3)} ${p1y.toFixed(3)} ` +
    `L ${p2x.toFixed(3)} ${p2y.toFixed(3)} ` +
    `L ${p3x.toFixed(3)} ${p3y.toFixed(3)} Z`
  );
}

/**
 * Decide the inward-pointing arrow direction for a boundary cell. Picks the
 * cardinal axis whose neighbor is in-shape; falls back to nearest centroid.
 */
function arrowDirectionForBoundaryCell(
  grid: MazeGrid,
  cell: MazeCell,
): "N" | "S" | "E" | "W" {
  const neighbors: Array<{ dir: "N" | "S" | "E" | "W"; dx: number; dy: number }> = [
    { dir: "S", dx: 0, dy: 1 },   // pointing down (PDF: south)
    { dir: "N", dx: 0, dy: -1 },  // pointing up
    { dir: "E", dx: 1, dy: 0 },
    { dir: "W", dx: -1, dy: 0 },
  ];
  for (const n of neighbors) {
    const nx = cell.x + n.dx;
    const ny = cell.y + n.dy;
    if (
      ny >= 0 &&
      ny < grid.cellsDown &&
      nx >= 0 &&
      nx < grid.cellsAcross &&
      grid.inShape[ny] !== undefined &&
      grid.inShape[ny][nx] === true
    ) {
      // The arrow points TOWARD the in-shape neighbor (i.e. into the maze).
      // In PDF, "S" means downward, "N" upward.
      if (n.dir === "S") return "S";
      if (n.dir === "N") return "N";
      if (n.dir === "E") return "E";
      return "W";
    }
  }
  return "S";
}

export interface MazeRenderResult {
  metrics: CellMetrics;
}

/**
 * Stamp a collectible / boss sprite at the center of a maze cell. Sprite size
 * clamps to ≤ 80% of cell width so it doesn't kiss the corridor walls.
 *
 * `drawImage` lives outside drawSvgPath's Y-flip, so we compute PDF-native
 * (Y-up) coords here directly.
 */
export function drawSpriteAtCell(
  page: PDFPage,
  sprite: PDFImage,
  cell: MazeCell,
  metrics: CellMetrics,
  cellsDown: number,
  scale = 0.8,
): void {
  const centerX = metrics.originX + (cell.x + 0.5) * metrics.cell;
  const centerY = metrics.originY + (cellsDown - cell.y - 0.5) * metrics.cell;
  const target = metrics.cell * scale;
  const ratio = sprite.width / sprite.height;
  let drawW = target;
  let drawH = target;
  if (ratio > 1) drawH = target / ratio;
  else if (ratio < 1) drawW = target * ratio;
  const x = centerX - drawW / 2;
  const y = centerY - drawH / 2;
  page.drawImage(sprite, { x, y, width: drawW, height: drawH });
}

/**
 * Render the maze onto a PDF page. Returns the metrics so the caller can
 * stamp icons (collectibles, boss) at the same coordinates.
 */
export function renderMaze(
  page: PDFPage,
  grid: MazeGrid,
  rect: MazeRenderRect,
  options: MazeRenderOptions = {},
): MazeRenderResult {
  const metrics = computeMazeMetrics(grid, rect);
  const boundaryWidth = options.boundaryStrokeWidth ?? 1.5;
  const interiorWidth = options.interiorStrokeWidth ?? 0.75;
  const showSolution = options.showSolutionPath ?? false;
  const bw = options.blackAndWhiteSafe ?? false;
  const drawArrows = options.drawArrows ?? true;

  const boundaryWalls: WallSegment[] = [];
  const interiorWalls: WallSegment[] = [];
  for (const w of grid.walls) {
    if (w.kind === "boundary") boundaryWalls.push(w);
    else interiorWalls.push(w);
  }

  const origin = svgOrigin(metrics, metrics.drawnHeight);

  // Boundary walls — heavier stroke.
  if (boundaryWalls.length > 0) {
    const path = wallsToSvgPath(boundaryWalls, metrics);
    page.drawSvgPath(path, {
      x: origin.x,
      y: origin.y,
      borderColor: BLACK,
      borderWidth: boundaryWidth,
      borderLineCap: LineCapStyle.Projecting,
    });
  }

  // Interior walls.
  if (interiorWalls.length > 0) {
    const path = wallsToSvgPath(interiorWalls, metrics);
    page.drawSvgPath(path, {
      x: origin.x,
      y: origin.y,
      borderColor: BLACK,
      borderWidth: interiorWidth,
      borderLineCap: LineCapStyle.Projecting,
    });
  }

  // Solution path (answer key).
  if (showSolution && grid.solutionPath.length > 1) {
    const solutionSvg = solutionPathToSvgPath(grid.solutionPath, metrics);
    if (bw) {
      page.drawSvgPath(solutionSvg, {
        x: origin.x,
        y: origin.y,
        borderColor: BLACK,
        borderWidth: 1.0,
        borderDashArray: [6, 4],
        borderDashPhase: 0,
        borderLineCap: LineCapStyle.Round,
        borderOpacity: 0.95,
      });
    } else {
      page.drawSvgPath(solutionSvg, {
        x: origin.x,
        y: origin.y,
        borderColor: RED,
        borderWidth: 1.5,
        borderLineCap: LineCapStyle.Round,
        borderOpacity: 0.85,
      });
    }
  }

  // Entry / exit arrows — small filled triangles outside the boundary.
  if (drawArrows) {
    const entranceDir = arrowDirectionForBoundaryCell(grid, grid.entrance);
    const exitDir = arrowDirectionForBoundaryCell(grid, grid.exit);
    const arrowSize = Math.max(6, metrics.cell * 0.55);
    const entCenter = cellCenterSvg(grid.entrance, metrics);
    const exitCenter = cellCenterSvg(grid.exit, metrics);
    // Move the arrow just outside the boundary along the inward direction
    // (in SVG-down coords: N = smaller y, S = larger y).
    const offset = metrics.cell * 0.85;
    const entAnchor = { x: entCenter.x, y: entCenter.y };
    const exitAnchor = { x: exitCenter.x, y: exitCenter.y };
    if (entranceDir === "S") entAnchor.y -= offset;
    else if (entranceDir === "N") entAnchor.y += offset;
    else if (entranceDir === "E") entAnchor.x -= offset;
    else entAnchor.x += offset;
    if (exitDir === "S") exitAnchor.y -= offset;
    else if (exitDir === "N") exitAnchor.y += offset;
    else if (exitDir === "E") exitAnchor.x -= offset;
    else exitAnchor.x += offset;

    page.drawSvgPath(
      chevronSvgPath(entAnchor.x, entAnchor.y, entranceDir, arrowSize),
      {
        x: origin.x,
        y: origin.y,
        color: bw ? BLACK : pdfRgb(0.16, 0.39, 0.85),
        borderColor: bw ? BLACK : pdfRgb(0.16, 0.39, 0.85),
        borderWidth: 0.8,
        borderLineCap: LineCapStyle.Round,
      },
    );
    page.drawSvgPath(
      chevronSvgPath(exitAnchor.x, exitAnchor.y, exitDir, arrowSize),
      {
        x: origin.x,
        y: origin.y,
        color: bw ? BLACK : RED,
        borderColor: bw ? BLACK : RED,
        borderWidth: 0.8,
        borderLineCap: LineCapStyle.Round,
      },
    );
  }

  return { metrics };
}
