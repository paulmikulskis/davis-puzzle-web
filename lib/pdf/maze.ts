// Renders a MazeGrid into a pdf-lib PDFPage as SVG paths.
// One drawSvgPath call per layer (boundary, interior, solution path).
// Coordinates are cell-grid units; the caller passes a transform so the maze
// fits inside the desired page region.

import { LineCapStyle, rgb as pdfRgb, type PDFPage } from "pdf-lib";
import type { MazeCell, MazeGrid, WallSegment } from "@/lib/maze";

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
 * Map a wall segment in cell-grid units to PDF-points coordinates.
 * Grid (x, y) origin is top-left, y growing downward; PDF origin is bottom-
 * left, y growing upward. We flip y on the way out.
 */
function wallToPdf(
  seg: WallSegment,
  m: CellMetrics,
  cellsDown: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const x1 = m.originX + seg.x1 * m.cell;
  const x2 = m.originX + seg.x2 * m.cell;
  // Flip y: grid y=0 is top, so PDF y = originY + (cellsDown - gridY) * cell
  const y1 = m.originY + (cellsDown - seg.y1) * m.cell;
  const y2 = m.originY + (cellsDown - seg.y2) * m.cell;
  return { x1, y1, x2, y2 };
}

function cellCenterPdf(
  cell: MazeCell,
  m: CellMetrics,
  cellsDown: number,
): { x: number; y: number } {
  const x = m.originX + (cell.x + 0.5) * m.cell;
  const y = m.originY + (cellsDown - cell.y - 0.5) * m.cell;
  return { x, y };
}

/**
 * Build an SVG path string from a list of wall segments. Each segment becomes
 * an `M x1 y1 L x2 y2` pair. Coordinates are absolute PDF points.
 */
function wallsToSvgPath(
  walls: WallSegment[],
  m: CellMetrics,
  cellsDown: number,
): string {
  const parts: string[] = [];
  for (const seg of walls) {
    const { x1, y1, x2, y2 } = wallToPdf(seg, m, cellsDown);
    parts.push(`M ${x1.toFixed(3)} ${y1.toFixed(3)} L ${x2.toFixed(3)} ${y2.toFixed(3)}`);
  }
  return parts.join(" ");
}

function solutionPathToSvgPath(
  path: MazeCell[],
  m: CellMetrics,
  cellsDown: number,
): string {
  if (path.length === 0) return "";
  const first = path[0];
  if (!first) return "";
  const start = cellCenterPdf(first, m, cellsDown);
  const parts: string[] = [`M ${start.x.toFixed(3)} ${start.y.toFixed(3)}`];
  for (let i = 1; i < path.length; i += 1) {
    const c = path[i];
    if (!c) continue;
    const p = cellCenterPdf(c, m, cellsDown);
    parts.push(`L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
  }
  return parts.join(" ");
}

/** Build a small filled triangle (chevron/arrowhead) SVG path. */
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
    p1x = x; p1y = y + half;
    p2x = x - half; p2y = y - half;
    p3x = x + half; p3y = y - half;
  } else if (direction === "S") {
    p1x = x; p1y = y - half;
    p2x = x - half; p2y = y + half;
    p3x = x + half; p3y = y + half;
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

  // Boundary walls — heavier stroke.
  if (boundaryWalls.length > 0) {
    const path = wallsToSvgPath(boundaryWalls, metrics, grid.cellsDown);
    page.drawSvgPath(path, {
      borderColor: BLACK,
      borderWidth: boundaryWidth,
      borderLineCap: LineCapStyle.Projecting,
    });
  }

  // Interior walls.
  if (interiorWalls.length > 0) {
    const path = wallsToSvgPath(interiorWalls, metrics, grid.cellsDown);
    page.drawSvgPath(path, {
      borderColor: BLACK,
      borderWidth: interiorWidth,
      borderLineCap: LineCapStyle.Projecting,
    });
  }

  // Solution path (answer key).
  if (showSolution && grid.solutionPath.length > 1) {
    const solutionSvg = solutionPathToSvgPath(
      grid.solutionPath,
      metrics,
      grid.cellsDown,
    );
    if (bw) {
      page.drawSvgPath(solutionSvg, {
        borderColor: BLACK,
        borderWidth: 1.0,
        borderDashArray: [6, 4],
        borderDashPhase: 0,
        borderLineCap: LineCapStyle.Round,
        borderOpacity: 0.95,
      });
    } else {
      page.drawSvgPath(solutionSvg, {
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
    const entCenter = cellCenterPdf(grid.entrance, metrics, grid.cellsDown);
    const exitCenter = cellCenterPdf(grid.exit, metrics, grid.cellsDown);
    // Place the arrow just outside the boundary. Move opposite to direction.
    const offset = metrics.cell * 0.85;
    const entAnchor = { x: entCenter.x, y: entCenter.y };
    const exitAnchor = { x: exitCenter.x, y: exitCenter.y };
    if (entranceDir === "S") entAnchor.y += offset;
    else if (entranceDir === "N") entAnchor.y -= offset;
    else if (entranceDir === "E") entAnchor.x -= offset;
    else entAnchor.x += offset;
    if (exitDir === "S") exitAnchor.y += offset;
    else if (exitDir === "N") exitAnchor.y -= offset;
    else if (exitDir === "E") exitAnchor.x -= offset;
    else exitAnchor.x += offset;

    page.drawSvgPath(
      chevronSvgPath(entAnchor.x, entAnchor.y, entranceDir, arrowSize),
      {
        color: bw ? BLACK : pdfRgb(0.16, 0.39, 0.85),
        borderColor: bw ? BLACK : pdfRgb(0.16, 0.39, 0.85),
        borderWidth: 0.8,
        borderLineCap: LineCapStyle.Round,
      },
    );
    page.drawSvgPath(
      chevronSvgPath(exitAnchor.x, exitAnchor.y, exitDir, arrowSize),
      {
        color: bw ? BLACK : RED,
        borderColor: bw ? BLACK : RED,
        borderWidth: 0.8,
        borderLineCap: LineCapStyle.Round,
      },
    );
  }

  return { metrics };
}
