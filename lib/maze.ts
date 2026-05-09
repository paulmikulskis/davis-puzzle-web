// Procedural maze generator for the Maze Hunt feature.
// Recursive backtracking (DFS) on an in-shape mask. Output shape is consumed by
// the collectible placer (F4) and the PDF / SVG renderers (F7) — see plan.md §7.2
// and planning/maze-hunts/03-feature-maze-generator.md for the full spec.

import { generateSeed, makeRng } from "./maze/rng";
import {
  circle as rasterCircle,
  findEntranceCell,
  hexagon as rasterHexagon,
  oval as rasterOval,
  plus as rasterPlus,
  rectangle as rasterRectangle,
  ring as rasterRing,
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
  | { kind: "star4"; boundingBox: number }
  | { kind: "hexagon"; boundingBox: number }
  | { kind: "ring"; boundingBox: number }
  | { kind: "plus"; boundingBox: number }
  | { kind: "oval"; width: number; height: number };

export type MazeSilhouetteKind =
  | "rectangle"
  | "circle"
  | "star4"
  | "hexagon"
  | "ring"
  | "plus"
  | "oval";

export type MazeStyle = "labyrinth" | "balanced" | "branchy";

export interface MazeBranchEntry {
  cell: MazeCell;
  depth: number;
}

export interface MazeBranch {
  rootIndex: number;
  cells: MazeBranchEntry[];
}

export interface MazeGrid {
  silhouette: { kind: MazeSilhouetteKind; cellsAcross: number };
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
  style: MazeStyle;
}

export type CellCountPreset = "small" | "medium" | "large";

export interface GenerateMazeOptions {
  silhouette: Silhouette;
  cellCountPreset: CellCountPreset;
  entrance: CardinalPosition;
  exit: CardinalPosition;
  seed?: string;
  /** Carving algorithm. Default "labyrinth" preserves Epic 1 behavior:
   *  long winding corridors via recursive backtracking. "balanced" uses
   *  Kruskal's MST for evenly distributed branching, "branchy" uses Prim's
   *  for short corridors with many dead-ends. All produce perfect mazes
   *  (single solution), so the answer-key contract is preserved. */
  style?: MazeStyle;
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

// Hexagon: cellsAcross is the long horizontal axis (vertex-to-vertex).
const HEXAGON_PRESETS: Record<CellCountPreset, number> = {
  small: 16,
  medium: 20,
  large: 24,
};

// Ring: outer-diameter cell count. Need a few extra cells over circle so the
// ring corridor stays > 1 cell wide.
const RING_PRESETS: Record<CellCountPreset, number> = {
  small: 16,
  medium: 20,
  large: 24,
};

const PLUS_PRESETS: Record<CellCountPreset, number> = {
  small: 16,
  medium: 20,
  large: 24,
};

// Oval: width × height. Landscape (width > height) reads naturally on the
// portrait worksheet's left column, which is taller than wide.
const OVAL_PRESETS: Record<
  CellCountPreset,
  { width: number; height: number }
> = {
  small: { width: 16, height: 12 },
  medium: { width: 20, height: 16 },
  large: { width: 24, height: 20 },
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
  kind: MazeSilhouetteKind;
  cellsAcross: number;
  cellsDown: number;
  inShape: boolean[][];
}

function resolveSilhouette(
  silhouette: Silhouette,
  preset: CellCountPreset,
): ResolvedSilhouette {
  if (silhouette.kind === "rectangle") {
    const explicit =
      Number.isFinite(silhouette.width) &&
      Number.isFinite(silhouette.height) &&
      silhouette.width > 0 &&
      silhouette.height > 0;
    const dims = explicit
      ? {
          width: Math.floor(silhouette.width),
          height: Math.floor(silhouette.height),
        }
      : RECTANGLE_PRESETS[preset];
    return {
      kind: "rectangle",
      cellsAcross: dims.width,
      cellsDown: dims.height,
      inShape: rasterRectangle(dims.width, dims.height),
    };
  }
  if (silhouette.kind === "circle") {
    const explicit =
      Number.isFinite(silhouette.diameter) && silhouette.diameter > 0;
    const N = explicit ? Math.floor(silhouette.diameter) : CIRCLE_PRESETS[preset];
    return {
      kind: "circle",
      cellsAcross: N,
      cellsDown: N,
      inShape: rasterCircle(N),
    };
  }
  if (silhouette.kind === "star4") {
    const explicit =
      Number.isFinite(silhouette.boundingBox) && silhouette.boundingBox > 0;
    const N = explicit ? Math.floor(silhouette.boundingBox) : STAR_PRESETS[preset];
    return {
      kind: "star4",
      cellsAcross: N,
      cellsDown: N,
      inShape: rasterStar4(N),
    };
  }
  if (silhouette.kind === "hexagon") {
    const explicit =
      Number.isFinite(silhouette.boundingBox) && silhouette.boundingBox > 0;
    const N = explicit
      ? Math.floor(silhouette.boundingBox)
      : HEXAGON_PRESETS[preset];
    const inShape = rasterHexagon(N);
    return {
      kind: "hexagon",
      cellsAcross: N,
      cellsDown: inShape.length,
      inShape,
    };
  }
  if (silhouette.kind === "ring") {
    const explicit =
      Number.isFinite(silhouette.boundingBox) && silhouette.boundingBox > 0;
    const N = explicit
      ? Math.floor(silhouette.boundingBox)
      : RING_PRESETS[preset];
    return {
      kind: "ring",
      cellsAcross: N,
      cellsDown: N,
      inShape: rasterRing(N),
    };
  }
  if (silhouette.kind === "plus") {
    const explicit =
      Number.isFinite(silhouette.boundingBox) && silhouette.boundingBox > 0;
    const N = explicit
      ? Math.floor(silhouette.boundingBox)
      : PLUS_PRESETS[preset];
    return {
      kind: "plus",
      cellsAcross: N,
      cellsDown: N,
      inShape: rasterPlus(N),
    };
  }
  // oval
  const explicit =
    Number.isFinite(silhouette.width) &&
    Number.isFinite(silhouette.height) &&
    silhouette.width > 0 &&
    silhouette.height > 0;
  const dims = explicit
    ? {
        width: Math.floor(silhouette.width),
        height: Math.floor(silhouette.height),
      }
    : OVAL_PRESETS[preset];
  return {
    kind: "oval",
    cellsAcross: dims.width,
    cellsDown: dims.height,
    inShape: rasterOval(dims.width, dims.height),
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

// ---------------------------------------------------------------------------
// Carve algorithms — all produce a `Set<passageKey>` describing which adjacent
// in-shape cell pairs share an open corridor. Walls are derived later by
// subtracting passages from the universe of interior walls.
// ---------------------------------------------------------------------------

interface CarveContext {
  cellsAcross: number;
  cellsDown: number;
  isIn: (x: number, y: number) => boolean;
  rng: ReturnType<typeof makeRng>;
  entrance: MazeCell;
  visitKey: (x: number, y: number) => string;
}

/** Recursive backtracking DFS — long winding corridors, "labyrinth" feel. */
function carveDfs(ctx: CarveContext): Set<string> {
  const passages = new Set<string>();
  const visited = new Set<string>();
  const stack: MazeCell[] = [{ x: ctx.entrance.x, y: ctx.entrance.y }];
  visited.add(ctx.visitKey(ctx.entrance.x, ctx.entrance.y));
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (!top) break;
    const { x, y } = top;
    const candidates: Array<{ nx: number; ny: number }> = [];
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!ctx.isIn(nx, ny)) continue;
      if (visited.has(ctx.visitKey(nx, ny))) continue;
      candidates.push({ nx, ny });
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const choice = candidates[ctx.rng.pickInt(candidates.length)];
    if (!choice) {
      stack.pop();
      continue;
    }
    passages.add(passageKey(x, y, choice.nx, choice.ny));
    visited.add(ctx.visitKey(choice.nx, choice.ny));
    stack.push({ x: choice.nx, y: choice.ny });
  }
  return passages;
}

/** Kruskal's MST on the cell graph — even branching, no length bias. */
function carveKruskal(ctx: CarveContext): Set<string> {
  const passages = new Set<string>();
  // Collect all candidate edges (each adjacent in-shape cell pair, once).
  const edges: Array<[number, number, number, number]> = [];
  for (let y = 0; y < ctx.cellsDown; y++) {
    for (let x = 0; x < ctx.cellsAcross; x++) {
      if (!ctx.isIn(x, y)) continue;
      // Only emit east + south edges to avoid duplicates.
      if (ctx.isIn(x + 1, y)) edges.push([x, y, x + 1, y]);
      if (ctx.isIn(x, y + 1)) edges.push([x, y, x, y + 1]);
    }
  }
  ctx.rng.shuffle(edges);
  // Disjoint-set union.
  const parent = new Map<string, string>();
  const findRoot = (k: string): string => {
    let cur = k;
    while (true) {
      const p = parent.get(cur);
      if (p === undefined || p === cur) {
        if (p === undefined) parent.set(cur, cur);
        return cur;
      }
      const grand = parent.get(p) ?? p;
      parent.set(cur, grand);
      cur = grand;
    }
  };
  const union = (a: string, b: string): boolean => {
    const ra = findRoot(a);
    const rb = findRoot(b);
    if (ra === rb) return false;
    parent.set(ra, rb);
    return true;
  };
  for (const [ax, ay, bx, by] of edges) {
    const ka = ctx.visitKey(ax, ay);
    const kb = ctx.visitKey(bx, by);
    if (union(ka, kb)) passages.add(passageKey(ax, ay, bx, by));
  }
  return passages;
}

/** Prim's frontier-based MST — short corridors, branchy/twiggy feel. */
function carvePrim(ctx: CarveContext): Set<string> {
  const passages = new Set<string>();
  const inMaze = new Set<string>();
  const startKey = ctx.visitKey(ctx.entrance.x, ctx.entrance.y);
  inMaze.add(startKey);
  // Frontier = list of edges where one endpoint is in-maze and the other is
  // an in-shape but out-of-maze neighbor. Stored as 4-tuples of cell coords.
  const frontier: Array<[number, number, number, number]> = [];
  const seedFrontier = (x: number, y: number) => {
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!ctx.isIn(nx, ny)) continue;
      if (inMaze.has(ctx.visitKey(nx, ny))) continue;
      frontier.push([x, y, nx, ny]);
    }
  };
  seedFrontier(ctx.entrance.x, ctx.entrance.y);
  while (frontier.length > 0) {
    const idx = ctx.rng.pickInt(frontier.length);
    const last = frontier[frontier.length - 1];
    const edge = frontier[idx];
    if (!edge) break;
    if (idx !== frontier.length - 1 && last) frontier[idx] = last;
    frontier.pop();
    const [, , bx, by] = edge;
    const bKey = ctx.visitKey(bx, by);
    if (inMaze.has(bKey)) continue;
    const [ax, ay] = edge;
    passages.add(passageKey(ax, ay, bx, by));
    inMaze.add(bKey);
    seedFrontier(bx, by);
  }
  return passages;
}

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

  // Carve passages via the chosen algorithm. All three are perfect-maze
  // generators (single solution, no loops) so the answer-key contract holds.
  const visitKey = (x: number, y: number): string => `${x},${y}`;
  const style: MazeStyle = opts.style ?? "labyrinth";
  const carveCtx: CarveContext = {
    cellsAcross,
    cellsDown,
    isIn,
    rng,
    entrance,
    visitKey,
  };
  const passages: Set<string> =
    style === "labyrinth"
      ? carveDfs(carveCtx)
      : style === "balanced"
        ? carveKruskal(carveCtx)
        : carvePrim(carveCtx);

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
    style,
  };
}
