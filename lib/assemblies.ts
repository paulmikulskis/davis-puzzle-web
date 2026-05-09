// Curated catalog of canonical Minecraft assemblies for Maze Hunt v1.
//
// PER MASTER PLAN §7.5: the cutout-count is owned by the assembly, not by the
// collectible placer. PDF page 1 is the proof — 6 ender crystals on the maze,
// 5 ladder cutouts in the panel, deliberate. F4's PlacementResult.totalCount
// drives the prompt count, not the cutout panel.
//
// Three assemblies for v1:
//   - obsidian_pillar  (page 1 — End Island)
//   - wither_summon    (page 2 — Nether)
//   - hopper_furnace   (page 3 — Ocean Monument, includes wet→dry state change)
//
// Crafting Table, Brewing Stand, Snow Golem are deferred to v1.5 per plan.md §4.

export type ItemRef = string; // canonicalName from lib/catalog.ts

export type AssemblySlot =
  | { kind: "blank" }
  | { kind: "decorative"; item: ItemRef }
  | {
      kind: "paste";
      defaultItem: ItemRef;
      /** What the answer-key shows. May differ from defaultItem (state change). */
      answerItem: ItemRef;
      positionalConstraint?: boolean;
    };

export interface CutoutSpec {
  item: ItemRef;
  count: number;
  borderStyle: "thick";
}

export type AssemblyId =
  | "obsidian_pillar"
  | "wither_summon"
  | "hopper_furnace";

export interface Assembly {
  assemblyId: AssemblyId;
  displayName: string;
  description: string;
  /** [row][col]; row 0 is the top of the assembly. */
  gridShape: AssemblySlot[][];
  cutoutPanel: CutoutSpec[];
  biomeAffinity: string[];
  scalingAxis: "size" | "count" | "shape" | "none";
  scalingPresets?: { small: number; medium: number; large: number };
  answerKeyDefault: "pre-pasted" | "blank";
  hasStateChange: boolean;
}

const blank: AssemblySlot = { kind: "blank" };

/** Page 1: vertical column of 5 cells. Cutouts: 5 ladders. Answer key: blank. */
const obsidianPillar: Assembly = {
  assemblyId: "obsidian_pillar",
  displayName: "Obsidian Pillar",
  description: "Climb the obsidian pillar to the dragon's perch.",
  gridShape: [
    [{ kind: "paste", defaultItem: "Ladder", answerItem: "Ladder" }],
    [{ kind: "paste", defaultItem: "Ladder", answerItem: "Ladder" }],
    [{ kind: "paste", defaultItem: "Ladder", answerItem: "Ladder" }],
    [{ kind: "paste", defaultItem: "Ladder", answerItem: "Ladder" }],
    [{ kind: "paste", defaultItem: "Ladder", answerItem: "Ladder" }],
  ],
  cutoutPanel: [{ item: "Ladder", count: 5, borderStyle: "thick" }],
  biomeAffinity: ["end"],
  scalingAxis: "count",
  scalingPresets: { small: 3, medium: 5, large: 8 },
  answerKeyDefault: "blank",
  hasStateChange: false,
};

/** Page 2: canonical Wither summon T (3 skulls top + 4 soul sand T). */
const witherSummon: Assembly = {
  assemblyId: "wither_summon",
  displayName: "Wither Summon",
  description: "Build the canonical Wither summon: 4 soul sand and 3 skulls.",
  gridShape: [
    [
      {
        kind: "paste",
        defaultItem: "Wither_Skeleton_Skull",
        answerItem: "Wither_Skeleton_Skull",
        positionalConstraint: true,
      },
      {
        kind: "paste",
        defaultItem: "Wither_Skeleton_Skull",
        answerItem: "Wither_Skeleton_Skull",
        positionalConstraint: true,
      },
      {
        kind: "paste",
        defaultItem: "Wither_Skeleton_Skull",
        answerItem: "Wither_Skeleton_Skull",
        positionalConstraint: true,
      },
    ],
    [
      blank,
      {
        kind: "paste",
        defaultItem: "Soul_Sand",
        answerItem: "Soul_Sand",
        positionalConstraint: true,
      },
      blank,
    ],
    [
      {
        kind: "paste",
        defaultItem: "Soul_Sand",
        answerItem: "Soul_Sand",
        positionalConstraint: true,
      },
      {
        kind: "paste",
        defaultItem: "Soul_Sand",
        answerItem: "Soul_Sand",
        positionalConstraint: true,
      },
      {
        kind: "paste",
        defaultItem: "Soul_Sand",
        answerItem: "Soul_Sand",
        positionalConstraint: true,
      },
    ],
  ],
  cutoutPanel: [
    { item: "Wither_Skeleton_Skull", count: 3, borderStyle: "thick" },
    { item: "Soul_Sand", count: 4, borderStyle: "thick" },
  ],
  biomeAffinity: ["nether"],
  scalingAxis: "shape",
  answerKeyDefault: "pre-pasted",
  hasStateChange: false,
};

/**
 * Page 3: 5×2 hopper grid + side furnace. Wet sponge cutouts, dry sponge in
 * the answer key (state change happens in the furnace).
 *
 * Layout: hopper grid spans columns 0-4 (rows 0-1); furnace occupies column 5
 * stacked vertically (rows 0-2 = input / fuel / output).
 */
const hopperFurnace: Assembly = {
  assemblyId: "hopper_furnace",
  displayName: "Hopper + Furnace",
  description: "Drop wet sponges into the hopper and dry them in the furnace.",
  gridShape: [
    [
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
    ],
    [
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      { kind: "paste", defaultItem: "Wet_Sponge", answerItem: "Sponge" },
      blank,
      blank,
    ],
    [blank, blank, blank, blank, blank, { kind: "paste", defaultItem: "Sponge", answerItem: "Sponge" }],
  ],
  cutoutPanel: [{ item: "Wet_Sponge", count: 10, borderStyle: "thick" }],
  biomeAffinity: ["ocean"],
  scalingAxis: "count",
  scalingPresets: { small: 5, medium: 8, large: 10 },
  answerKeyDefault: "pre-pasted",
  hasStateChange: true,
};

const ASSEMBLIES: Record<AssemblyId, Assembly> = {
  obsidian_pillar: obsidianPillar,
  wither_summon: witherSummon,
  hopper_furnace: hopperFurnace,
};

export function getAssembly(id: AssemblyId): Assembly {
  return ASSEMBLIES[id];
}

export function listAssemblies(): Assembly[] {
  return [obsidianPillar, witherSummon, hopperFurnace];
}

/**
 * Map a maze-hunt theme's `assembly.key` (kebab-case from the JSON) to the
 * canonical `AssemblyId`. Themes use kebab-case for stable URL/JSON shape;
 * code uses snake_case for the actual assembly ids.
 */
export function assemblyIdFromKey(key: string): AssemblyId | null {
  switch (key) {
    case "obsidian-pillar-ladder":
    case "obsidian_pillar":
      return "obsidian_pillar";
    case "wither-summon-t":
    case "wither_summon":
      return "wither_summon";
    case "hopper-furnace":
    case "hopper_furnace":
      return "hopper_furnace";
    default:
      return null;
  }
}
