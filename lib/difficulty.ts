/**
 * Per-puzzle difficulty signal for OT calibration.
 *
 * Andrew Davis (the OT) needs a quick "is this within the child's current
 * capacity?" tag on each puzzle. We compute a small set of signals from the
 * already-extracted palette + cell layout, then bucket into easy / medium /
 * hard with transparent thresholds.
 *
 * All signals are pure functions over PaletteEntry[]. No DOM. No React.
 *
 * Calibration insight: with 8-way quantization on a 16x16 sprite, raw signals
 * collapse — most items end up with 7-8 palette entries, ~25-30% dominant
 * share, and 25-45 isolated cells regardless of perceived difficulty. The
 * signals that DO separate the calibration set:
 *
 *   1. fragmentCount: total connected components across all colors. A clean
 *      apple has a few big blobs; a fish has dozens of speckles.
 *   2. fragmentsPerColor: same as above, normalized by palette size — an
 *      "average shape coherence" per color.
 *   3. effectivePaletteSize: colors that hold >= 5% of cells. This filters
 *      out the long tail of one-pixel quant artifacts.
 *
 * Bucketing is additive ("difficulty points"): each signal that crosses a
 * threshold contributes points (positive = harder, negative = easier). The
 * total maps to a bucket via two cutoff constants.
 *
 * Threshold provenance: tuned against the calibration fixture
 * (lib/difficulty.fixture.ts) until the hand-labeled OT-intuition buckets
 * matched. Numbers below are visible and named — no magic numbers buried in
 * conditionals.
 */

import {
  COLUMNS,
  GRID_N,
  ROWS,
  cellLabelToPoint,
  type PaletteEntry,
} from "@/lib/palette";

// -----------------------------------------------------------------------------
// Tunable thresholds. Tweaks here ripple through the calibration fixture.
// -----------------------------------------------------------------------------

/** Colors holding less than this share are not counted in effectivePaletteSize. */
const EFFECTIVE_COLOR_MIN_SHARE = 0.05;

/** effectivePaletteSize >= this adds a hard-leaning point. */
const EFFECTIVE_PALETTE_LARGE = 7;
/** effectivePaletteSize <= this adds an easy-leaning point. */
const EFFECTIVE_PALETTE_SMALL = 4;

/**
 * Min pairwise distance among palette colors in RGB space (0..~441).
 * Below this, two colors are "easy to confuse" (think pink-vs-salmon-vs-orange
 * on a Cooked_Salmon icon). Lower = harder.
 */
const COLOR_DISTANCE_LOW = 30;

/**
 * Mean pairwise color distance — overall palette spread. Lower mean means
 * the icon lives in a narrow color band (pinks-and-oranges on a fish).
 */
const MEAN_COLOR_DISTANCE_LOW = 90;
const MEAN_COLOR_DISTANCE_HIGH = 140;

/** fragmentCount >= this adds a hard-leaning point (lots of speckles). */
const FRAGMENTS_HIGH = 60;
/** fragmentCount >= this adds another hard-leaning point. */
const FRAGMENTS_VERY_HIGH = 65;
/** fragmentCount <= this adds an easy-leaning point (clean shapes). */
const FRAGMENTS_LOW = 35;

/** Score >= this lands in "hard". */
const HARD_SCORE = 3;
/** Score >= this lands in "medium" (otherwise easy). */
const MEDIUM_SCORE = 1;

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type DifficultyBucket = "easy" | "medium" | "hard";

export interface DifficultySignals {
  /** Number of palette entries (distinct colors after quantization). */
  paletteSize: number;
  /** Palette entries that hold >= EFFECTIVE_COLOR_MIN_SHARE of cells. */
  effectivePaletteSize: number;
  /** Total opaque cells across all palette entries. */
  opaqueCellCount: number;
  /**
   * Shannon entropy (bits) over per-color cell-count distribution. Higher
   * means "no color dominates", which is harder to plan around. (Diagnostic
   * only on 16x16 quantized sprites — see file-level comment.)
   */
  paletteEntropy: number;
  /** Fraction of opaque cells in the largest palette entry (0..1). */
  dominantShare: number;
  /**
   * Mean across colors of (average distance to color's centroid) divided by
   * the idealized disk radius for that color's cell count. Lower = tightly
   * clustered, higher = scattered. (Diagnostic only — elongated shapes
   * inflate this without being "harder".)
   */
  meanCompactness: number;
  /** Cells with zero orthogonally-adjacent same-color cell. (Diagnostic only.) */
  isolatedCellCount: number;
  /**
   * Fraction of orthogonal adjacent-opaque-cell pairs whose two cells have
   * different colors. Higher = busier visual boundary. (Diagnostic only.)
   */
  edgeDensity: number;
  /**
   * Total connected components (4-neighbor) across all palette entries.
   * Higher = more visually fragmented = harder.
   */
  fragmentCount: number;
  /** fragmentCount / paletteSize. Higher = more shapes per color. */
  fragmentsPerColor: number;
  /**
   * Minimum Euclidean distance in RGB space between any two palette colors.
   * Range 0..~441. Lower = some pair of colors looks confusingly similar.
   */
  minColorDistance: number;
  /**
   * Mean pairwise Euclidean distance across all palette color pairs. Lower =
   * palette lives in a narrow color band (e.g. pinks-and-oranges).
   */
  meanColorDistance: number;
}

export interface DifficultyResult {
  bucket: DifficultyBucket;
  /** One-sentence human-readable explanation of the dominant signal. */
  explanation: string;
  /** Computed signals for introspection. */
  signals: DifficultySignals;
  /** The integer score that fed into bucketing. Useful for debugging. */
  score: number;
}

// -----------------------------------------------------------------------------
// Signal functions (pure)
// -----------------------------------------------------------------------------

export function paletteSize(palette: PaletteEntry[]): number {
  return palette.length;
}

export function opaqueCellCount(palette: PaletteEntry[]): number {
  let total = 0;
  for (const entry of palette) total += entry.cells.length;
  return total;
}

export function paletteEntropy(palette: PaletteEntry[]): number {
  const total = opaqueCellCount(palette);
  if (total === 0 || palette.length <= 1) return 0;
  let h = 0;
  for (const entry of palette) {
    if (entry.cells.length === 0) continue;
    const p = entry.cells.length / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function dominantShare(palette: PaletteEntry[]): number {
  const total = opaqueCellCount(palette);
  if (total === 0) return 0;
  let max = 0;
  for (const entry of palette) {
    if (entry.cells.length > max) max = entry.cells.length;
  }
  return max / total;
}

export function meanCompactness(palette: PaletteEntry[]): number {
  const ratios: number[] = [];
  for (const entry of palette) {
    if (entry.cells.length < 2) continue; // single cell is trivially compact
    const points = entry.cells.map((c) => cellLabelToPoint(c));
    let cx = 0;
    let cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;

    let avgDist = 0;
    for (const p of points) {
      avgDist += Math.hypot(p.x - cx, p.y - cy);
    }
    avgDist /= points.length;

    // Idealized disk radius for N cells of unit area: sqrt(N / pi).
    // For a perfectly packed disk, mean radius is ~ (2/3) * outer radius, so
    // we don't try to be exact — we just compare against sqrt(N/pi).
    const idealRadius = Math.sqrt(points.length / Math.PI);
    if (idealRadius > 0) {
      ratios.push(avgDist / idealRadius);
    }
  }
  if (ratios.length === 0) return 0;
  let sum = 0;
  for (const r of ratios) sum += r;
  return sum / ratios.length;
}

export function isolatedCellCount(palette: PaletteEntry[]): number {
  const colorAt = buildColorMap(palette);
  let isolated = 0;
  for (let y = 0; y < GRID_N; y += 1) {
    for (let x = 0; x < GRID_N; x += 1) {
      const here = colorAt[y * GRID_N + x];
      if (here < 0) continue;
      let hasSameNeighbor = false;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_N || ny >= GRID_N) continue;
        if (colorAt[ny * GRID_N + nx] === here) {
          hasSameNeighbor = true;
          break;
        }
      }
      if (!hasSameNeighbor) isolated += 1;
    }
  }
  return isolated;
}

export function minColorDistance(palette: PaletteEntry[]): number {
  if (palette.length < 2) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    for (let j = i + 1; j < palette.length; j += 1) {
      const d = rgbDistance(palette[i].rgb, palette[j].rgb);
      if (d < min) min = d;
    }
  }
  return min;
}

export function meanColorDistance(palette: PaletteEntry[]): number {
  if (palette.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < palette.length; i += 1) {
    for (let j = i + 1; j < palette.length; j += 1) {
      sum += rgbDistance(palette[i].rgb, palette[j].rgb);
      pairs += 1;
    }
  }
  return sum / pairs;
}

function rgbDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function effectivePaletteSize(palette: PaletteEntry[]): number {
  const total = opaqueCellCount(palette);
  if (total === 0) return 0;
  let count = 0;
  for (const entry of palette) {
    if (entry.cells.length / total >= EFFECTIVE_COLOR_MIN_SHARE) count += 1;
  }
  return count;
}

/**
 * Count 4-connected components across all palette entries. Each color is
 * flood-filled separately so two same-color blobs separated by another color
 * count as two fragments.
 */
export function fragmentCount(palette: PaletteEntry[]): number {
  const colorAt = buildColorMap(palette);
  const visited = new Uint8Array(GRID_N * GRID_N);
  let total = 0;

  for (let y = 0; y < GRID_N; y += 1) {
    for (let x = 0; x < GRID_N; x += 1) {
      const idx = y * GRID_N + x;
      if (visited[idx]) continue;
      const c = colorAt[idx];
      if (c < 0) continue;
      total += 1;
      // BFS flood fill of same color
      const stack: number[] = [idx];
      visited[idx] = 1;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cy = Math.floor(cur / GRID_N);
        const cx = cur % GRID_N;
        for (const [dx, dy] of NEIGHBORS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_N || ny >= GRID_N) continue;
          const nidx = ny * GRID_N + nx;
          if (visited[nidx]) continue;
          if (colorAt[nidx] !== c) continue;
          visited[nidx] = 1;
          stack.push(nidx);
        }
      }
    }
  }
  return total;
}

export function fragmentsPerColor(palette: PaletteEntry[]): number {
  if (palette.length === 0) return 0;
  return fragmentCount(palette) / palette.length;
}

export function edgeDensity(palette: PaletteEntry[]): number {
  const colorAt = buildColorMap(palette);
  let opaquePairs = 0;
  let differentPairs = 0;
  // Count each unordered orthogonal pair once: right and down.
  for (let y = 0; y < GRID_N; y += 1) {
    for (let x = 0; x < GRID_N; x += 1) {
      const here = colorAt[y * GRID_N + x];
      if (here < 0) continue;
      // right neighbor
      if (x + 1 < GRID_N) {
        const r = colorAt[y * GRID_N + (x + 1)];
        if (r >= 0) {
          opaquePairs += 1;
          if (r !== here) differentPairs += 1;
        }
      }
      // down neighbor
      if (y + 1 < GRID_N) {
        const d = colorAt[(y + 1) * GRID_N + x];
        if (d >= 0) {
          opaquePairs += 1;
          if (d !== here) differentPairs += 1;
        }
      }
    }
  }
  if (opaquePairs === 0) return 0;
  return differentPairs / opaquePairs;
}

// -----------------------------------------------------------------------------
// Bucketing
// -----------------------------------------------------------------------------

interface ScoreContribution {
  /** Positive = harder, negative = easier. */
  delta: number;
  /** Identifier for selecting the dominant signal. */
  signal: keyof DifficultySignals;
  /** Magnitude of how strongly this signal pushes (used to pick "dominant"). */
  weight: number;
}

export function computeDifficulty(palette: PaletteEntry[]): DifficultyResult {
  const fragments = fragmentCount(palette);
  const signals: DifficultySignals = {
    paletteSize: paletteSize(palette),
    effectivePaletteSize: effectivePaletteSize(palette),
    opaqueCellCount: opaqueCellCount(palette),
    paletteEntropy: paletteEntropy(palette),
    dominantShare: dominantShare(palette),
    meanCompactness: meanCompactness(palette),
    isolatedCellCount: isolatedCellCount(palette),
    edgeDensity: edgeDensity(palette),
    fragmentCount: fragments,
    fragmentsPerColor: palette.length > 0 ? fragments / palette.length : 0,
    minColorDistance: minColorDistance(palette),
    meanColorDistance: meanColorDistance(palette),
  };

  const contributions: ScoreContribution[] = [];

  // Effective palette size — how many real colors do you actually track?
  if (signals.effectivePaletteSize >= EFFECTIVE_PALETTE_LARGE) {
    contributions.push({ delta: +1, signal: "effectivePaletteSize", weight: 1 });
  } else if (signals.effectivePaletteSize <= EFFECTIVE_PALETTE_SMALL) {
    contributions.push({ delta: -1, signal: "effectivePaletteSize", weight: 1 });
  }

  // Compound: narrow color band + enough effective colors = OT-hard color
  // confusion (think Cooked_Salmon's eight-pink palette, or Bread's seven
  // browns). A narrow band with a tiny effective palette (Stick's four close
  // browns) is NOT the same — the child only has to discriminate four shades.
  const narrowBand =
    signals.meanColorDistance <= MEAN_COLOR_DISTANCE_LOW;
  const wideGamut =
    signals.meanColorDistance >= MEAN_COLOR_DISTANCE_HIGH;
  const enoughEffectiveForConfusion = signals.effectivePaletteSize >= 5;
  const manyEffective = signals.effectivePaletteSize >= 6;
  // Wide gamut should only excuse difficulty if the icon is also not too
  // fragmented. Pufferfish has both wide gamut AND 69 fragments — the spread
  // doesn't help when there are dozens of speckles to keep track of.
  const veryFragmented = signals.fragmentCount >= FRAGMENTS_VERY_HIGH;

  if (narrowBand && manyEffective) {
    // 6+ confusing colors — full hard penalty (Cooked_Salmon, Pufferfish-on-the-edge).
    contributions.push({ delta: +2, signal: "meanColorDistance", weight: 3 });
  } else if (narrowBand && enoughEffectiveForConfusion) {
    // 5 confusing colors — partial penalty (Bread's seven-brown palette,
    // Coal's gray run). Enough to nudge toward medium, not enough alone to
    // jump to hard.
    contributions.push({ delta: +1, signal: "meanColorDistance", weight: 2 });
  } else if (wideGamut && !veryFragmented) {
    contributions.push({ delta: -1, signal: "meanColorDistance", weight: 1 });
  }

  // Min color distance — are any two colors confusingly similar?
  // Only flag when there's also enough effective palette to matter.
  if (signals.minColorDistance <= COLOR_DISTANCE_LOW && manyEffective) {
    contributions.push({ delta: +1, signal: "minColorDistance", weight: 1 });
  }

  // Fragment count — how broken-up is the icon overall.
  if (signals.fragmentCount >= FRAGMENTS_VERY_HIGH) {
    contributions.push({ delta: +2, signal: "fragmentCount", weight: 2 });
  } else if (signals.fragmentCount >= FRAGMENTS_HIGH) {
    contributions.push({ delta: +1, signal: "fragmentCount", weight: 1 });
  } else if (signals.fragmentCount <= FRAGMENTS_LOW) {
    contributions.push({ delta: -1, signal: "fragmentCount", weight: 1 });
  }

  let score = 0;
  for (const c of contributions) score += c.delta;

  let bucket: DifficultyBucket;
  if (score >= HARD_SCORE) bucket = "hard";
  else if (score >= MEDIUM_SCORE) bucket = "medium";
  else bucket = "easy";

  const explanation = buildExplanation(bucket, signals, contributions);

  return { bucket, explanation, signals, score };
}

function buildExplanation(
  bucket: DifficultyBucket,
  signals: DifficultySignals,
  contributions: ScoreContribution[],
): string {
  // Pick the dominant signal — same direction as the bucket (harder vs easier),
  // then highest weight, ties broken by signal priority order below.
  const direction = bucket === "easy" ? -1 : +1;
  const aligned = contributions.filter((c) =>
    bucket === "easy" ? c.delta < 0 : c.delta > 0,
  );

  const priority: Record<keyof DifficultySignals, number> = {
    meanColorDistance: 11,
    minColorDistance: 10,
    effectivePaletteSize: 9,
    fragmentCount: 8,
    fragmentsPerColor: 7,
    paletteSize: 6,
    isolatedCellCount: 5,
    dominantShare: 4,
    edgeDensity: 3,
    paletteEntropy: 2,
    meanCompactness: 1,
    opaqueCellCount: 0,
  };

  const dominant =
    aligned.sort(
      (a, b) =>
        b.weight - a.weight ||
        priority[b.signal] - priority[a.signal],
    )[0] ?? null;

  if (bucket === "medium" && !dominant) {
    return `Mixed signals: ${signals.paletteSize} colors, ${signals.opaqueCellCount} cells, dominant color covers ${pct(signals.dominantShare)} of the icon.`;
  }

  if (!dominant) {
    // Score 0 with no aligned signal — usually a "boring middle" icon.
    // Surface the gamut + cell count so the tooltip is still informative.
    return `Balanced ${bucket} icon: ${signals.effectivePaletteSize} real colors over ${signals.opaqueCellCount} cells, mean pairwise color distance ${Math.round(signals.meanColorDistance)}.`;
  }

  const pieces = describeSignal(dominant.signal, signals, direction);
  return pieces;
}

function describeSignal(
  signal: keyof DifficultySignals,
  s: DifficultySignals,
  direction: number,
): string {
  const harder = direction > 0;
  switch (signal) {
    case "meanColorDistance":
      return harder
        ? `Palette lives in a narrow color band (mean pairwise distance ${Math.round(s.meanColorDistance)}), so colors look similar to each other.`
        : `Palette spans a wide color gamut (mean pairwise distance ${Math.round(s.meanColorDistance)}), so colors are easy to tell apart.`;
    case "minColorDistance":
      return harder
        ? `Two palette colors are close enough (distance ${Math.round(s.minColorDistance)}) that a child can confuse them.`
        : `All palette colors are visually distinct (closest pair distance ${Math.round(s.minColorDistance)}).`;
    case "effectivePaletteSize":
      return harder
        ? `${s.effectivePaletteSize} real colors to track (palette of ${s.paletteSize}, plus quantization remainders).`
        : `Only ${s.effectivePaletteSize} real colors carry the icon, keeping choices simple.`;
    case "fragmentCount":
      return harder
        ? `Icon is broken into ${s.fragmentCount} same-color regions — lots of small pieces to track.`
        : `Icon settles into ${s.fragmentCount} clean same-color regions, easy to scan.`;
    case "fragmentsPerColor":
      return harder
        ? `Each color shows up in ${s.fragmentsPerColor.toFixed(1)} separate pieces on average.`
        : `Each color stays in ~${s.fragmentsPerColor.toFixed(1)} clean piece on average.`;
    case "paletteSize":
      return harder
        ? `Wide palette of ${s.paletteSize} colors makes color matching demanding.`
        : `Small palette of ${s.paletteSize} colors keeps choices simple.`;
    case "isolatedCellCount":
      return harder
        ? `${s.isolatedCellCount} lone cells with no same-color neighbor demand careful tracking.`
        : `Only ${s.isolatedCellCount} lone cells, so most colors stay in connected runs.`;
    case "dominantShare":
      return harder
        ? `No single color dominates (top color covers just ${pct(s.dominantShare)} of cells).`
        : `One background color covers ${pct(s.dominantShare)} of cells, leaving fewer fiddly choices.`;
    case "edgeDensity":
      return harder
        ? `Busy boundaries: ${pct(s.edgeDensity)} of adjacent cell pairs swap colors.`
        : `Calm boundaries: only ${pct(s.edgeDensity)} of adjacent cells swap colors.`;
    case "paletteEntropy":
      return harder
        ? `Color counts are evenly spread (entropy ${s.paletteEntropy.toFixed(2)} bits), so no color is a freebie.`
        : `Color counts are uneven (entropy ${s.paletteEntropy.toFixed(2)} bits), giving easy quick-wins.`;
    case "meanCompactness":
      return harder
        ? `Colors are scattered across the grid rather than clustered.`
        : `Colors stay tightly clustered, easy to scan and fill.`;
    case "opaqueCellCount":
      return `${s.opaqueCellCount} cells to color.`;
  }
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Build a flat (col, row) -> color-index lookup. Color index is the palette
 * entry index (which uniquely identifies a color); -1 means transparent.
 *
 * Note on Int8Array: palette size is bounded above by maxColors (typically 8,
 * see the page UI in app/page.tsx), so Int8 is more than enough headroom.
 */
function buildColorMap(palette: PaletteEntry[]): Int8Array {
  const map = new Int8Array(GRID_N * GRID_N).fill(-1);
  palette.forEach((entry, colorIdx) => {
    for (const label of entry.cells) {
      const { x, y } = cellLabelToPoint(label);
      map[y * GRID_N + x] = colorIdx;
    }
  });
  return map;
}

// Hint to the type system that ROWS/COLUMNS are referenced; keeps lint happy
// if the bundler treats this file as having only type-level uses elsewhere.
void ROWS;
void COLUMNS;
