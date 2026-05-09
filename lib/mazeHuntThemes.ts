// Static theme bundle for the Maze Hunt activity selector. Generated as a
// hand-edited JSON file at public/maze-hunt-themes.json and loaded by the
// browser the same way CatalogBrowser loads public/items.json.
//
// The shape mirrors §6 of planning/maze-hunts/02-feature-activity-selector.md.
// The interfaces below are the single source of truth for both the JSON file
// and downstream consumers (selector card, editor, PDF renderer).

export type MazeSilhouette =
  | "circle"
  | "rectangle"
  | "diamond-star"
  | "rounded-rectangle";

export type DifficultyPreset = "easy" | "medium" | "hard";

export type CorridorDensity = "sparse" | "medium" | "dense";

export type CutoutSize = "small" | "medium" | "large";

export type BossPlacement =
  | "center"
  | "corner-ne"
  | "corner-nw"
  | "corner-se"
  | "corner-sw";

export interface MazeHuntDifficultyDefaults {
  /** Maze grid cells per side, e.g. Easy=12, Medium=16, Hard=20. */
  cellsPerSide: number;
  /** Visual density of corridor branching. */
  corridorDensity: CorridorDensity;
  /** Number of collectibles placed along the maze. */
  collectibleCount: number;
  /** True = every collectible on the solution path; false = mixed on/off. */
  collectiblesAllOnPath: boolean;
  /** Number of cutout tiles for assembly. Typically equals collectibleCount. */
  cutoutCount: number;
  /** Scissor-difficulty knob for the cutout sheet. */
  cutoutSize: CutoutSize;
  /** Number of objectives shown on the worksheet. Typically 3 or 4. */
  objectiveCount: number;
}

export interface MazeHuntCollectible {
  /** canonicalName matching public/items.json (Title_Snake form). */
  canonicalName: string;
  /** Human display label, e.g. "wither skull". */
  displayLabel: string;
}

export interface MazeHuntAssembly {
  /** Registered assembly renderer key (Feature 5). */
  key: string;
  /** Default fill item canonicalName. */
  defaultFillItem: string;
  /** Cutout sheet item canonicalName. May differ from fill (e.g. wet→dry). */
  cutoutItem: string;
}

export interface MazeHuntBoss {
  /** Entity canonicalName matching public/items.json. */
  canonicalName: string;
  displayLabel: string;
  placement: BossPlacement;
}

export interface MazeHuntObjectivePhrasing {
  /** Verb-led template with {count} placeholder. */
  collectTemplate: string;
  bossTemplate: string;
  escapeTemplate: string;
  assembleTemplate: string;
}

export interface MazeHuntTheme {
  /** Stable kebab-case slug, e.g. "end-island". */
  id: string;
  /** Bumped to break preset compatibility. */
  version: 1;
  displayName: string;
  shortDescription: string;
  thumbnailPath: string;
  /** Hex color for card border + difficulty pill ring. */
  accentColor: string;
  silhouette: MazeSilhouette;
  /** 1–2 entries; multiple supports mixed-collectible themes (Nether). */
  collectibles: MazeHuntCollectible[];
  boss: MazeHuntBoss;
  assembly: MazeHuntAssembly;
  objectives: MazeHuntObjectivePhrasing;
  difficulties: Record<DifficultyPreset, MazeHuntDifficultyDefaults>;
  defaultDifficulty: DifficultyPreset;
}

const SILHOUETTES: readonly MazeSilhouette[] = [
  "circle",
  "rectangle",
  "diamond-star",
  "rounded-rectangle",
];

const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  "easy",
  "medium",
  "hard",
];

const CORRIDOR_DENSITIES: readonly CorridorDensity[] = [
  "sparse",
  "medium",
  "dense",
];

const CUTOUT_SIZES: readonly CutoutSize[] = ["small", "medium", "large"];

const BOSS_PLACEMENTS: readonly BossPlacement[] = [
  "center",
  "corner-ne",
  "corner-nw",
  "corner-se",
  "corner-sw",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  members: readonly T[],
): value is T {
  return typeof value === "string" && (members as readonly string[]).includes(value);
}

function isMazeHuntDifficultyDefaults(
  value: unknown,
): value is MazeHuntDifficultyDefaults {
  if (!isRecord(value)) return false;
  return (
    typeof value.cellsPerSide === "number" &&
    Number.isFinite(value.cellsPerSide) &&
    isOneOf(value.corridorDensity, CORRIDOR_DENSITIES) &&
    typeof value.collectibleCount === "number" &&
    Number.isFinite(value.collectibleCount) &&
    typeof value.collectiblesAllOnPath === "boolean" &&
    typeof value.cutoutCount === "number" &&
    Number.isFinite(value.cutoutCount) &&
    isOneOf(value.cutoutSize, CUTOUT_SIZES) &&
    typeof value.objectiveCount === "number" &&
    Number.isFinite(value.objectiveCount)
  );
}

function isMazeHuntCollectible(value: unknown): value is MazeHuntCollectible {
  if (!isRecord(value)) return false;
  return (
    typeof value.canonicalName === "string" &&
    typeof value.displayLabel === "string"
  );
}

function isMazeHuntAssembly(value: unknown): value is MazeHuntAssembly {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === "string" &&
    typeof value.defaultFillItem === "string" &&
    typeof value.cutoutItem === "string"
  );
}

function isMazeHuntBoss(value: unknown): value is MazeHuntBoss {
  if (!isRecord(value)) return false;
  return (
    typeof value.canonicalName === "string" &&
    typeof value.displayLabel === "string" &&
    isOneOf(value.placement, BOSS_PLACEMENTS)
  );
}

function isMazeHuntObjectivePhrasing(
  value: unknown,
): value is MazeHuntObjectivePhrasing {
  if (!isRecord(value)) return false;
  return (
    typeof value.collectTemplate === "string" &&
    typeof value.bossTemplate === "string" &&
    typeof value.escapeTemplate === "string" &&
    typeof value.assembleTemplate === "string"
  );
}

function isDifficultyTable(
  value: unknown,
): value is Record<DifficultyPreset, MazeHuntDifficultyDefaults> {
  if (!isRecord(value)) return false;
  return DIFFICULTY_PRESETS.every((preset) =>
    isMazeHuntDifficultyDefaults(value[preset]),
  );
}

function isMazeHuntTheme(value: unknown): value is MazeHuntTheme {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (value.version !== 1) return false;
  if (typeof value.displayName !== "string") return false;
  if (typeof value.shortDescription !== "string") return false;
  if (typeof value.thumbnailPath !== "string") return false;
  if (typeof value.accentColor !== "string") return false;
  if (!isOneOf(value.silhouette, SILHOUETTES)) return false;
  if (!Array.isArray(value.collectibles)) return false;
  if (value.collectibles.length === 0) return false;
  if (!value.collectibles.every(isMazeHuntCollectible)) return false;
  if (!isMazeHuntBoss(value.boss)) return false;
  if (!isMazeHuntAssembly(value.assembly)) return false;
  if (!isMazeHuntObjectivePhrasing(value.objectives)) return false;
  if (!isDifficultyTable(value.difficulties)) return false;
  if (!isOneOf(value.defaultDifficulty, DIFFICULTY_PRESETS)) return false;
  return true;
}

/**
 * Validates an unknown value (typically the parsed JSON of
 * public/maze-hunt-themes.json) and returns a typed array of themes. Throws
 * with a descriptive message on the first failing entry. Keeping the
 * validation synchronous makes it trivial to unit-test against fixtures.
 */
export function parseMazeHuntThemes(value: unknown): MazeHuntTheme[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "maze-hunt-themes.json: expected top-level JSON array of themes",
    );
  }
  const themes: MazeHuntTheme[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (!isMazeHuntTheme(entry)) {
      const id =
        isRecord(entry) && typeof entry.id === "string" ? entry.id : `#${i}`;
      throw new Error(
        `maze-hunt-themes.json: theme entry ${id} failed validation`,
      );
    }
    themes.push(entry);
  }
  return themes;
}

/**
 * Fetches public/maze-hunt-themes.json and validates it. Mirrors
 * CatalogBrowser's loader: same `cache: "default"` policy, same shape of
 * "throw on invalid" so the caller can render a friendly error in the UI.
 */
export async function loadMazeHuntThemes(): Promise<MazeHuntTheme[]> {
  const response = await fetch("/maze-hunt-themes.json", { cache: "default" });
  if (!response.ok) {
    throw new Error(
      `maze-hunt-themes.json: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const json: unknown = await response.json();
  return parseMazeHuntThemes(json);
}
