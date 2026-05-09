// Collectible auto-placement engine for the Maze Hunt feature.
// Pure, deterministic, side-effect-free. Consumes a MazeGrid from F2 and a
// population spec from the editor, returns either a full valid placement or a
// typed PlacementInfeasible result. See plan.md §7.3 and
// planning/maze-hunts/05-feature-collectible-placement.md §3 for the full
// contract — especially §3.7 (no partial placements) and §3.8 (determinism).

import type { MazeBranch, MazeCell, MazeGrid } from "./maze";
import { makeRng } from "./maze/rng";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Placement {
  cell: MazeCell;
  itemRef: string;
}

export type PlacementResult =
  | {
      ok: true;
      placements: Placement[];
      placementsByItem: Record<string, Placement[]>;
      totalCount: number;
    }
  | {
      ok: false;
      reason:
        | "infeasible-not-enough-off-path"
        | "infeasible-spacing-too-tight"
        | "infeasible-type-constraint";
    };

export interface PlacementPopulationEntry {
  itemRef: string;
  count: number;
  constraint?: "on-path" | "off-path" | "any";
}

export interface PlacementInput {
  maze: MazeGrid;
  population: PlacementPopulationEntry[];
  mode: "all-on-path" | "mixed";
  mixedOnPathFraction?: number;
  minSpacingCells?: number;
  maxDetourDepth?: number;
  seed: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface OnPathTarget {
  itemRef: string;
  // Stable order tag from the input population, so we can reconstruct the
  // grouping deterministically once cells are picked.
  popIndex: number;
}

interface OffPathTarget {
  itemRef: string;
  popIndex: number;
}

interface OffPathCandidate {
  cell: MazeCell;
  rootIndex: number; // index into maze.solutionPath
  depth: number;
}

type Rng = ReturnType<typeof makeRng>;

function manhattan(a: MazeCell, b: MazeCell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Bucket the population list into on-path and off-path target arrays per the
// effective constraint of each entry. For "any" entries, follows §3.6 + the
// mode/mixedOnPathFraction rule.
function bucketPopulation(
  population: PlacementPopulationEntry[],
  mode: "all-on-path" | "mixed",
  mixedOnPathFraction: number,
): {
  onPath: OnPathTarget[];
  offPath: OffPathTarget[];
} {
  const onPath: OnPathTarget[] = [];
  const offPath: OffPathTarget[] = [];

  for (let i = 0; i < population.length; i++) {
    const entry = population[i];
    if (!entry || entry.count <= 0) continue;
    const effective = entry.constraint ?? "any";

    if (effective === "on-path") {
      for (let k = 0; k < entry.count; k++) {
        onPath.push({ itemRef: entry.itemRef, popIndex: i });
      }
      continue;
    }
    if (effective === "off-path") {
      for (let k = 0; k < entry.count; k++) {
        offPath.push({ itemRef: entry.itemRef, popIndex: i });
      }
      continue;
    }

    // effective === "any"
    if (mode === "all-on-path") {
      for (let k = 0; k < entry.count; k++) {
        onPath.push({ itemRef: entry.itemRef, popIndex: i });
      }
    } else {
      // Split per fraction; ceil for the on-path share so that small entries
      // (count=1) prefer the easier on-path bucket by default.
      const onShare = Math.min(
        entry.count,
        Math.max(0, Math.ceil(entry.count * mixedOnPathFraction)),
      );
      for (let k = 0; k < onShare; k++) {
        onPath.push({ itemRef: entry.itemRef, popIndex: i });
      }
      for (let k = 0; k < entry.count - onShare; k++) {
        offPath.push({ itemRef: entry.itemRef, popIndex: i });
      }
    }
  }

  return { onPath, offPath };
}

// Sample N cells from the on-path interior (excluding entrance + exit) at
// roughly even spacing, with deterministic per-slot jitter using the rng. If
// the path is too short to seat N cells even at spacing 1, returns null.
function sampleOnPathCells(
  solutionPath: MazeCell[],
  count: number,
  desiredSpacing: number,
  rng: Rng,
): MazeCell[] | null {
  if (count <= 0) return [];

  // Exclude entrance (index 0) and exit (last index) — collectibles directly
  // on the entrance/exit kiss the arrow glyphs. See planning §2.2.
  const interiorStart = 1;
  const interiorEnd = solutionPath.length - 1;
  const interiorLength = Math.max(0, interiorEnd - interiorStart);

  if (count > interiorLength) {
    // Even shoulder-to-shoulder we can't fit count cells.
    return null;
  }

  // Floor desired spacing to 1; the dominant constraint then becomes "fits at
  // all" rather than "evenly spaced". §3.7 says we should retry with relaxed
  // spacing down to a hard floor of 1 cell apart before giving up.
  const spacingFloor = 1;
  const spacing = Math.max(spacingFloor, Math.floor(desiredSpacing));

  // Try to place with the desired spacing first, then back off.
  for (let s = spacing; s >= spacingFloor; s--) {
    const result = trySampleOnPathCellsAtSpacing(
      solutionPath,
      count,
      s,
      interiorStart,
      interiorEnd,
      rng,
    );
    if (result) return result;
  }
  return null;
}

function trySampleOnPathCellsAtSpacing(
  solutionPath: MazeCell[],
  count: number,
  spacing: number,
  interiorStart: number,
  interiorEnd: number,
  rng: Rng,
): MazeCell[] | null {
  const interiorLength = interiorEnd - interiorStart;
  // Total cells consumed by N cells with `spacing` separation is
  // (N - 1) * spacing + 1. We need that to be ≤ interiorLength.
  if ((count - 1) * spacing + 1 > interiorLength) {
    return null;
  }

  // Pick anchor offsets evenly across the interior, then jitter ±1 within the
  // spacing slack budget so two seeds give different layouts.
  const slack = interiorLength - ((count - 1) * spacing + 1);
  // Distribute slack as a small per-slot jitter so the first/last items aren't
  // pinned to the very ends.
  const baseStart = interiorStart + Math.floor(slack / 2);
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    let idx = baseStart + i * spacing;
    // Apply ±1 jitter within slack budget. Each jitter step costs 1 unit of
    // global slack; track the running budget.
    const jitterBudget = Math.max(0, Math.min(1, slack));
    if (jitterBudget > 0) {
      const r = rng.next();
      const dir = r < 0.33 ? -1 : r < 0.66 ? 0 : 1;
      idx += dir;
    }
    if (idx < interiorStart) idx = interiorStart;
    if (idx > interiorEnd - 1) idx = interiorEnd - 1;
    indices.push(idx);
  }

  // Enforce strictly increasing indices (the jitter could collide).
  indices.sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i++) {
    const prev = indices[i - 1];
    const curr = indices[i];
    if (prev === undefined || curr === undefined) continue;
    const minNext = prev + spacing;
    if (curr < minNext) {
      indices[i] = minNext;
    }
    const fixed = indices[i];
    if (fixed === undefined) continue;
    if (fixed > interiorEnd - 1) {
      // Compaction failed — give up on this spacing.
      return null;
    }
  }

  const cells: MazeCell[] = [];
  for (const idx of indices) {
    const cell = solutionPath[idx];
    if (!cell) return null;
    cells.push(cell);
  }
  return cells;
}

// Flatten branch metadata into per-cell candidates, honoring the detour-depth
// cap (§3.3).
function flattenOffPathCandidates(
  branches: MazeBranch[] | undefined,
  maxDetourDepth: number,
): OffPathCandidate[] {
  if (!branches || branches.length === 0) return [];
  const out: OffPathCandidate[] = [];
  for (const branch of branches) {
    for (const entry of branch.cells) {
      if (entry.depth > maxDetourDepth) continue;
      out.push({
        cell: entry.cell,
        rootIndex: branch.rootIndex,
        depth: entry.depth,
      });
    }
  }
  return out;
}

// Pick `count` off-path candidates uniformly at random while respecting a
// minimum-spacing floor against the chosen on-path cells and against each
// other. Returns null only if even the spacing floor fails — capacity has
// already been gated by the caller.
function sampleOffPathCells(
  candidates: OffPathCandidate[],
  count: number,
  desiredSpacing: number,
  onPathCells: MazeCell[],
  rng: Rng,
): OffPathCandidate[] | null {
  if (count <= 0) return [];
  if (count > candidates.length) return null;

  const spacingFloor = 1;
  const startSpacing = Math.max(spacingFloor, Math.floor(desiredSpacing));

  for (let s = startSpacing; s >= spacingFloor; s--) {
    const shuffled = rng.shuffle(candidates);
    const chosen: OffPathCandidate[] = [];
    for (const cand of shuffled) {
      if (chosen.length === count) break;
      let ok = true;
      for (const c of chosen) {
        if (manhattan(cand.cell, c.cell) < s) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (const c of onPathCells) {
        if (manhattan(cand.cell, c) < s) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      chosen.push(cand);
    }
    if (chosen.length === count) return chosen;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function placeCollectibles(input: PlacementInput): PlacementResult {
  const rng = makeRng(input.seed);
  const maze = input.maze;
  const solutionPath = maze.solutionPath;
  const branches = maze.branches;

  const mixedOnPathFraction = input.mixedOnPathFraction ?? 0.5;
  const maxDetourDepth = input.maxDetourDepth ?? 4;

  // 1. Bucket population by effective constraint.
  const { onPath: onPathTargets, offPath: offPathTargets } = bucketPopulation(
    input.population,
    input.mode,
    mixedOnPathFraction,
  );

  const totalCount = onPathTargets.length + offPathTargets.length;
  if (totalCount === 0) {
    return {
      ok: true,
      placements: [],
      placementsByItem: {},
      totalCount: 0,
    };
  }

  // 2. Capacity gate — off-path bucket vs eligible candidates.
  const offPathCandidates = flattenOffPathCandidates(branches, maxDetourDepth);
  if (offPathTargets.length > offPathCandidates.length) {
    return { ok: false, reason: "infeasible-not-enough-off-path" };
  }

  // Per-type constraint capacity. Single-type entries with constraint
  // "off-path" can also fail this — covered by the off-path bucket gate above —
  // but a per-type "on-path" with count > path interior is its own infeasible
  // type-constraint failure (e.g. someone forces 50 on-path collectibles into
  // a 10-cell maze).
  const interiorOnPathCapacity = Math.max(0, solutionPath.length - 2);
  if (onPathTargets.length > interiorOnPathCapacity) {
    // Distinguish "the user asked for a per-type constraint that's
    // structurally unsatisfiable" from "spacing too tight". If any single
    // entry's on-path constraint forces > capacity, it's a type-constraint
    // failure; otherwise treat the aggregate overflow as spacing-too-tight.
    const anyForcedOnPath = input.population.some(
      (e) => e.constraint === "on-path" && e.count > interiorOnPathCapacity,
    );
    if (anyForcedOnPath) {
      return { ok: false, reason: "infeasible-type-constraint" };
    }
    return { ok: false, reason: "infeasible-spacing-too-tight" };
  }

  // 3. On-path placement with min-spacing.
  const desiredSpacing =
    input.minSpacingCells ??
    (totalCount > 0 ? Math.floor(solutionPath.length / totalCount) : 1);

  const onPathCells = sampleOnPathCells(
    solutionPath,
    onPathTargets.length,
    desiredSpacing,
    rng,
  );
  if (!onPathCells) {
    return { ok: false, reason: "infeasible-spacing-too-tight" };
  }

  // 4. Off-path placement, uniform with spacing against on-path picks.
  const offPathChosen = sampleOffPathCells(
    offPathCandidates,
    offPathTargets.length,
    desiredSpacing,
    onPathCells,
    rng,
  );
  if (!offPathChosen) {
    return { ok: false, reason: "infeasible-spacing-too-tight" };
  }

  // 5. Zip cells back to itemRefs deterministically.
  // On-path: itemRefs grouped per population order. Each chosen on-path cell
  // is sorted by solution-path index already (sampleOnPathCells returns them
  // in ascending order); we assign itemRefs in the same order they appear in
  // onPathTargets (which itself follows population order).
  const onPathPlacements: Placement[] = [];
  for (let i = 0; i < onPathTargets.length; i++) {
    const cell = onPathCells[i];
    const target = onPathTargets[i];
    if (!cell || !target) {
      return { ok: false, reason: "infeasible-spacing-too-tight" };
    }
    onPathPlacements.push({ cell, itemRef: target.itemRef });
  }

  // Off-path: order the chosen candidates by (rootIndex, depth, x, y) for
  // stable rendering, then zip with offPathTargets in population order.
  const offPathSorted = offPathChosen.slice().sort((a, b) => {
    if (a.rootIndex !== b.rootIndex) return a.rootIndex - b.rootIndex;
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.cell.x !== b.cell.x) return a.cell.x - b.cell.x;
    return a.cell.y - b.cell.y;
  });
  const offPathPlacements: Placement[] = [];
  for (let i = 0; i < offPathTargets.length; i++) {
    const cand = offPathSorted[i];
    const target = offPathTargets[i];
    if (!cand || !target) {
      return { ok: false, reason: "infeasible-spacing-too-tight" };
    }
    offPathPlacements.push({ cell: cand.cell, itemRef: target.itemRef });
  }

  // Final flat list: on-path first (already in solution-path order), then
  // off-path (already grouped by rootIndex/depth).
  const placements: Placement[] = [...onPathPlacements, ...offPathPlacements];

  // Group by itemRef for F6's prompt phrasing.
  const placementsByItem: Record<string, Placement[]> = {};
  for (const p of placements) {
    const list = placementsByItem[p.itemRef];
    if (list) {
      list.push(p);
    } else {
      placementsByItem[p.itemRef] = [p];
    }
  }

  return {
    ok: true,
    placements,
    placementsByItem,
    totalCount: placements.length,
  };
}
