// Procedural maze generator for the Maze Hunt feature.
// Recursive backtracking (DFS) on an in-shape mask. Output shape is consumed by
// the collectible placer (F4) and the PDF / SVG renderers (F7) — see plan.md §7.2
// and planning/maze-hunts/03-feature-maze-generator.md for the full spec.

import { generateSeed, makeRng } from "./maze/rng";
import {
  circle as rasterCircle,
  findEntranceCell,
  rectangle as rasterRectangle,
  star4 as rasterStar4,
  type CardinalPosition,
  type MazeCell,
} from "./maze/silhouettes";

export type { CardinalPosition, MazeCell };

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "boundary" | "interior";
}

export type Silhouette =
  | { kind: "rectangle"; width: number; height: number }
  | { kind: "circle"; diameter: number }
  | { kind: "star4"; boundingBox: number };

export interface MazeBranchEntry {
  cell: MazeCell;
  depth: number;
}

export interface MazeBranch {
  rootIndex: number;
  cells: MazeBranchEntry[];
}

export interface MazeGrid {
  silhouette: { kind: "circle" | "star4" | "rectangle"; cellsAcross: number };
  cellsAcross: number;
  cellsDown: number;
  inShape: boolean[][];
  walls: WallSegment[];
  entrance: MazeCell;
  exit: MazeCell;
  solutionPath: MazeCell[];
  distanceFromEntrance: number[][];
  deadEnds: MazeCell[];
  branches?: MazeBranch[];
  seed: string;
}

export type CellCountPreset = "small" | "medium" | "large";

export interface GenerateMazeOptions {
  silhouette: Silhouette;
  cellCountPreset: CellCountPreset;
  entrance: CardinalPosition;
  exit: CardinalPosition;
  seed?: string;
}

// ---------------------------------------------------------------------------
// Cell-count presets (per silhouette × preset). See planning §9.
// ---------------------------------------------------------------------------

const RECTANGLE_PRESETS: Record<CellCountPreset, { width: number; height: number }> = {
  small: { width: 12, height: 16 },
  medium: { width: 16, height: 20 },
  large: { width: 22, height: 27 },
};

const CIRCLE_PRESETS: Record<CellCountPreset, number> = {
  small: 14,
  medium: 18,
  large: 22,
};

const STAR_PRESETS: Record<CellCountPreset, number> = {
  small: 14,
  medium: 18,
  large: 22,
};

// ---------------------------------------------------------------------------
// Wall key helpers — used to dedupe and to track carved interior passages.
// ---------------------------------------------------------------------------

function wallKey(x1: number, y1: number, x2: number, y2: number): string {
  // Canonicalize endpoint order so a wall has the same key regardless of which
  // side asked for it.
  if (x1 < x2 || (x1 === x2 && y1 < y2)) {
    return `${x1},${y1}-${x2},${y2}`;
  }
  return `${x2},${y2}-${x1},${y1}`;
}

function passageKey(ax: number, ay: number, bx: number, by: number): string {
  if (ax < bx || (ax === bx && ay < by)) {
    return `${ax},${ay}|${bx},${by}`;
  }
  return `${bx},${by}|${ax},${ay}`;
}

// Build the wall segment that separates two horizontally- or vertically-
// adjacent cells. Cell (x, y) occupies the unit square with corners
// (x, y) → (x+1, y+1).
function wallBetween(ax: number, ay: number, bx: number, by: number): WallSegment {
  if (ay === by && Math.abs(ax - bx) === 1) {
    const minX = Math.min(ax, bx) + 1;
    return { x1: minX, y1: ay, x2: minX, y2: ay + 1, kind: "interior" };
  }
  if (ax === bx && Math.abs(ay - by) === 1) {
    const minY = Math.min(ay, by) + 1;
    return { x1: ax, y1: minY, x2: ax + 1, y2: minY, kind: "interior" };
  }
  throw new Error(
    `wallBetween: cells (${ax},${ay}) and (${bx},${by}) are not orthogonal neighbors`,
  );
}

// Boundary wall of a single cell on a given side. Side is the direction of the
// missing/out-of-shape neighbor.
function boundaryWall(x: number, y: number, side: "N" | "S" | "E" | "W"): WallSegment {
  if (side === "N") {
    return { x1: x, y1: y, x2: x + 1, y2: y, kind: "boundary" };
  }
  if (side === "S") {
    return { x1: x, y1: y + 1, x2: x + 1, y2: y + 1, kind: "boundary" };
  }
  if (side === "W") {
    return { x1: x, y1: y, x2: x, y2: y + 1, kind: "boundary" };
  }
  return { x1: x + 1, y1: y, x2: x + 1, y2: y + 1, kind: "boundary" };
}

// ---------------------------------------------------------------------------
// Silhouette resolution.
// ---------------------------------------------------------------------------

interface ResolvedSilhouette {
  kind: "circle" | "star4" | "rectangle";
  cellsAcross: number;
  cellsDown: number;
  inShape: boolean[][];
}

function resolveSilhouette(
  silhouette: Silhouette,
  preset: CellCountPreset,
): ResolvedSilhouette {
  if (silhouette.kind === "rectangle") {
    // Honor explicit dims if both look real, else fall back to preset table.
    const explicit =
      Number.isFinite(silhouette.width) &&
      Number.isFinite(silhouette.height) &&
      silhouette.width > 0 &&
      silhouette.height > 0;
    const dims = explicit
      ? { width: Math.floor(silhouette.width), height: Math.floor(silhouette.height) }
      : RECTANGLE_PRESETS[preset];
    return {
      kind: "rectangle",
      cellsAcross: dims.width,
      cellsDown: dims.height,
      inShape: rasterRectangle(dims.width, dims.height),
    };
  }
  if (silhouette.kind === "circle") {
    const explicit = Number.isFinite(silhouette.diameter) && silhouette.diameter > 0;
    const N = explicit ? Math.floor(silhouette.diameter) : CIRCLE_PRESETS[preset];
    return {
      kind: "circle",
      cellsAcross: N,
      cellsDown: N,
      inShape: rasterCircle(N),
    };
  }
  const explicit = Number.isFinite(silhouette.boundingBox) && silhouette.boundingBox > 0;
  const N = explicit ? Math.floor(silhouette.boundingBox) : STAR_PRESETS[preset];
  return {
    kind: "star4",
    cellsAcross: N,
    cellsDown: N,
    inShape: rasterStar4(N),
  };
}

// ---------------------------------------------------------------------------
// Maze generation.
// ---------------------------------------------------------------------------

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, "N" | "S" | "E" | "W"]> = [
  [0, -1, "N"],
  [1, 0, "E"],
  [0, 1, "S"],
  [-1, 0, "W"],
];

export function generateMaze(opts: GenerateMazeOptions): MazeGrid {
  const seed = opts.seed && opts.seed.length > 0 ? opts.seed : generateSeed();
  const rng = makeRng(seed);

  const resolved = resolveSilhouette(opts.silhouette, opts.cellCountPreset);
  const { cellsAcross, cellsDown, inShape } = resolved;

  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && x < cellsAcross && y >= 0 && y < cellsDown;
  const isIn = (x: number, y: number): boolean => {
    if (!inBounds(x, y)) return false;
    const row = inShape[y];
    return row !== undefined && row[x] === true;
  };

  // Locate entrance and exit cells.
  const entrance = findEntranceCell(inShape, opts.entrance);
  const exit = findEntranceCell(inShape, opts.exit);

  // Build the universe of all interior walls + boundary walls.
  const interiorWallKeys = new Set<string>();
  const interiorWalls: WallSegment[] = [];
  const boundaryWalls: WallSegment[] = [];

  for (let y = 0; y < cellsDown; y++) {
    for (let x = 0; x < cellsAcross; x++) {
      if (!isIn(x, y)) continue;
      for (const [dx, dy, side] of NEIGHBOR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isIn(nx, ny)) {
          // Interior wall — dedupe via canonical key.
          const seg = wallBetween(x, y, nx, ny);
          const key = wallKey(seg.x1, seg.y1, seg.x2, seg.y2);
          if (!interiorWallKeys.has(key)) {
            interiorWallKeys.add(key);
            interiorWalls.push(seg);
          }
        } else {
          // Boundary wall — these are unique by construction.
          boundaryWalls.push(boundaryWall(x, y, side));
        }
      }
    }
  }

  // Recursive backtracking on the in-shape cells. Carved passages are tracked
  // by a Set keyed on the canonical cell-pair.
  const passages = new Set<string>();
  const visited = new Set<string>();
  const visitKey = (x: number, y: number): string => `${x},${y}`;

  const stack: MazeCell[] = [{ x: entrance.x, y: entrance.y }];
  visited.add(visitKey(entrance.x, entrance.y));

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (!top) break;
    const { x, y } = top;
    const candidates: Array<{ nx: number; ny: number }> = [];
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isIn(nx, ny)) continue;
      if (visited.has(visitKey(nx, ny))) continue;
      candidates.push({ nx, ny });
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const choiceIdx = rng.pickInt(candidates.length);
    const choice = candidates[choiceIdx];
    if (!choice) {
      stack.pop();
      continue;
    }
    passages.add(passageKey(x, y, choice.nx, choice.ny));
    visited.add(visitKey(choice.nx, choice.ny));
    stack.push({ x: choice.nx, y: choice.ny });
  }

  // Final wall list = boundary walls + interior walls whose passage was not
  // carved. (passageKey and wallKey use different formats but a 1:1 mapping —
  // we recompute the passage key from each interior wall's endpoints.)
  const walls: WallSegment[] = boundaryWalls.slice();
  for (const seg of interiorWalls) {
    // Recover the two cells separated by this segment.
    let ax: number;
    let ay: number;
    let bx: number;
    let by: number;
    if (seg.x1 === seg.x2) {
      // Vertical wall segment between cells (seg.x1 - 1, seg.y1) and (seg.x1, seg.y1).
      ax = seg.x1 - 1;
      ay = seg.y1;
      bx = seg.x1;
      by = seg.y1;
    } else {
      // Horizontal wall segment between cells (seg.x1, seg.y1 - 1) and (seg.x1, seg.y1).
      ax = seg.x1;
      ay = seg.y1 - 1;
      bx = seg.x1;
      by = seg.y1;
    }
    if (!passages.has(passageKey(ax, ay, bx, by))) {
      walls.push(seg);
    }
  }

  // BFS from entrance through carved passages — gives both the solution path
  // and the per-cell distance map used by F4.
  const distanceFromEntrance: number[][] = [];
  for (let y = 0; y < cellsDown; y++) {
    distanceFromEntrance.push(new Array(cellsAcross).fill(-1));
  }
  const parent = new Map<string, string | null>();
  const queue: MazeCell[] = [{ x: entrance.x, y: entrance.y }];
  const startRow = distanceFromEntrance[entrance.y];
  if (startRow) startRow[entrance.x] = 0;
  parent.set(visitKey(entrance.x, entrance.y), null);

  while (queue.length > 0) {
    const cell = queue.shift();
    if (!cell) break;
    const row = distanceFromEntrance[cell.y];
    if (!row) continue;
    const dist = row[cell.x];
    if (dist === undefined || dist < 0) continue;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!isIn(nx, ny)) continue;
      if (!passages.has(passageKey(cell.x, cell.y, nx, ny))) continue;
      const nrow = distanceFromEntrance[ny];
      if (!nrow) continue;
      if (nrow[nx] !== -1) continue;
      nrow[nx] = dist + 1;
      parent.set(visitKey(nx, ny), visitKey(cell.x, cell.y));
      queue.push({ x: nx, y: ny });
    }
  }

  // Reconstruct entrance → exit solution path.
  const solutionPath: MazeCell[] = [];
  const exitKey = visitKey(exit.x, exit.y);
  if (parent.has(exitKey)) {
    const trail: MazeCell[] = [];
    let cursor: string | null = exitKey;
    while (cursor !== null && cursor !== undefined) {
      const [sx, sy] = cursor.split(",");
      const cx = Number(sx);
      const cy = Number(sy);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) break;
      trail.push({ x: cx, y: cy });
      const next = parent.get(cursor);
      cursor = next === undefined ? null : next;
    }
    trail.reverse();
    solutionPath.push(...trail);
  }

  // Dead-ends: in-shape cells with exactly one carved-passage neighbor. The
  // entrance and exit cells are excluded because their "open mouth" is the
  // boundary, not a corridor branching point.
  const deadEnds: MazeCell[] = [];
  for (let y = 0; y < cellsDown; y++) {
    for (let x = 0; x < cellsAcross; x++) {
      if (!isIn(x, y)) continue;
      let openCount = 0;
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!isIn(nx, ny)) continue;
        if (passages.has(passageKey(x, y, nx, ny))) openCount++;
      }
      if (openCount === 1 && !(x === entrance.x && y === entrance.y) && !(x === exit.x && y === exit.y)) {
        deadEnds.push({ x, y });
      }
    }
  }

  // Side branches off the solution path. For each on-path cell, walk every
  // off-path subtree reachable through carved passages (not crossing the path).
  const onPathSet = new Set<string>(solutionPath.map((c) => visitKey(c.x, c.y)));
  const branches: MazeBranch[] = [];
  for (let i = 0; i < solutionPath.length; i++) {
    const root = solutionPath[i];
    if (!root) continue;
    const cells: MazeBranchEntry[] = [];
    const localVisited = new Set<string>();
    localVisited.add(visitKey(root.x, root.y));
    // Seed with off-path neighbors.
    const work: Array<{ cell: MazeCell; depth: number }> = [];
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = root.x + dx;
      const ny = root.y + dy;
      if (!isIn(nx, ny)) continue;
      if (!passages.has(passageKey(root.x, root.y, nx, ny))) continue;
      const nKey = visitKey(nx, ny);
      if (onPathSet.has(nKey)) continue;
      work.push({ cell: { x: nx, y: ny }, depth: 1 });
    }
    while (work.length > 0) {
      const item = work.pop();
      if (!item) break;
      const cellKey = visitKey(item.cell.x, item.cell.y);
      if (localVisited.has(cellKey)) continue;
      localVisited.add(cellKey);
      cells.push({ cell: item.cell, depth: item.depth });
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nx = item.cell.x + dx;
        const ny = item.cell.y + dy;
        if (!isIn(nx, ny)) continue;
        if (!passages.has(passageKey(item.cell.x, item.cell.y, nx, ny))) continue;
        const nKey = visitKey(nx, ny);
        if (onPathSet.has(nKey)) continue;
        if (localVisited.has(nKey)) continue;
        work.push({ cell: { x: nx, y: ny }, depth: item.depth + 1 });
      }
    }
    if (cells.length > 0) {
      branches.push({ rootIndex: i, cells });
    }
  }

  return {
    silhouette: { kind: resolved.kind, cellsAcross },
    cellsAcross,
    cellsDown,
    inShape,
    walls,
    entrance,
    exit,
    solutionPath,
    distanceFromEntrance,
    deadEnds,
    branches,
    seed,
  };
}
