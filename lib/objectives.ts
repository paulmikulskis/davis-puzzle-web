// Objective list composer for Maze Hunt worksheets.
//
// Pure module. Reads the chosen theme bundle, the live placement counts (so
// the prompt count and the maze can never drift apart — see plan.md §7.3),
// and the assembly definition; emits an ordered list of imperative objective
// lines that match the verbatim PDF voice.
//
// Per Feature 6 spec (planning/maze-hunts/07-feature-objective-composer.md):
//   - Slots: navigate, find, escape, craft, state-change.
//   - Multi-item navigate (Nether: skulls + soul sand) emits one navigate
//     line per collectible group.
//   - Terminal craft step is always present and non-removable.
//   - Andrew overrides are sticky-by-slot. When the override's literal
//     count token disagrees with the live placement count, we surface a
//     `countMismatch` so the renderer can badge the row.
//
// Pluralization defers to lib/catalog.ts `assetPlural()` — that module is the
// single source of truth for ad-hoc plural rules, mass nouns, and overrides.

import {
  assetPlural,
  assetSingular,
  type CatalogAsset,
  type CatalogFile,
} from "@/lib/catalog";
import type { Assembly } from "@/lib/assemblies";
import type { Placement } from "@/lib/placement";
import type { MazeHuntTheme } from "@/lib/mazeHuntThemes";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ObjectiveSlot =
  | "navigate"
  | "find"
  | "escape"
  | "craft"
  | "state-change";

export interface Objective {
  slot: ObjectiveSlot;
  text: string;
  /** True if this line is an Andrew override (not auto-derived). */
  isOverride: boolean;
  /** When isOverride=true and the override count token disagrees with the
   *  live placement count, the renderer surfaces a mismatch badge. */
  countMismatch?: { expected: number; foundInOverride: number | null };
}

export interface CatalogLookup {
  findAsset(canonicalName: string): CatalogAsset | undefined;
}

export interface ComposeObjectivesInput {
  theme: MazeHuntTheme;
  placementsByItem: Record<string, Placement[]>;
  assembly?: Assembly;
  catalog: CatalogLookup;
  /** Optional Andrew overrides keyed by slot. */
  overrides?: Partial<Record<ObjectiveSlot, string>>;
}

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

/**
 * Build an in-memory CatalogLookup from the parsed CatalogFile. The lookup
 * spans all three asset kinds (item / block / entity) so collectible names
 * (blocks), boss names (entities), and pixel-puzzle items can all resolve
 * through the same handle.
 */
export function buildCatalogLookup(file: CatalogFile): CatalogLookup {
  const byName = new Map<string, CatalogAsset>();
  for (const asset of file.items) byName.set(asset.canonicalName, asset);
  for (const asset of file.blocks) byName.set(asset.canonicalName, asset);
  for (const asset of file.entities) byName.set(asset.canonicalName, asset);
  return {
    findAsset(canonicalName: string): CatalogAsset | undefined {
      return byName.get(canonicalName);
    },
  };
}

// ---------------------------------------------------------------------------
// Token interpolation
// ---------------------------------------------------------------------------

interface TokenContext {
  count?: number;
  itemSingular?: string;
  itemPlural?: string;
  boss?: string;
  target?: string;
}

function interpolate(template: string, tokens: TokenContext): string {
  let out = template;
  if (tokens.count !== undefined) {
    out = out.replaceAll("{count}", String(tokens.count));
  }
  if (tokens.itemSingular !== undefined) {
    out = out.replaceAll("{item-singular}", tokens.itemSingular);
  }
  if (tokens.itemPlural !== undefined) {
    out = out.replaceAll("{item-plural}", tokens.itemPlural);
  }
  if (tokens.boss !== undefined) {
    out = out.replaceAll("{boss}", tokens.boss);
  }
  if (tokens.target !== undefined) {
    out = out.replaceAll("{target}", tokens.target);
  }
  return out;
}

/** Lowercased fallback when the catalog has no asset for a given itemRef. */
function fallbackPlural(displayLabel: string, count: number): string {
  if (count === 1) return displayLabel;
  // Cheap defaults so unknown-asset paths still render something readable.
  if (/(s|sh|ch|x|z)$/i.test(displayLabel)) return `${displayLabel}es`;
  if (/[^aeiou]y$/i.test(displayLabel)) {
    return `${displayLabel.slice(0, -1)}ies`;
  }
  return `${displayLabel}s`;
}

function lower(s: string): string {
  // Item names inside an objective render lowercase per F6 §3.4.
  return s.toLowerCase();
}

interface NormalizedCollectible {
  canonicalName: string;
  displayLabel: string;
  count: number;
  singular: string;
  plural: string;
}

function normalizeCollectibles(
  theme: MazeHuntTheme,
  placementsByItem: Record<string, Placement[]>,
  catalog: CatalogLookup,
): NormalizedCollectible[] {
  const out: NormalizedCollectible[] = [];
  for (const c of theme.collectibles) {
    const placed = placementsByItem[c.canonicalName] ?? [];
    const count = placed.length;
    const asset = catalog.findAsset(c.canonicalName);
    let singular: string;
    let plural: string;
    if (asset) {
      singular = lower(assetSingular(asset));
      plural = lower(assetPlural(asset, Math.max(2, count)));
      // assetPlural collapses to singular at count===1; we always want the
      // plural form for multi-count tokens, so feed it ≥2 for the plural slot.
      if (count === 1) {
        plural = lower(assetPlural(asset, 2));
      }
    } else {
      singular = lower(c.displayLabel);
      plural = lower(fallbackPlural(c.displayLabel, Math.max(2, count)));
    }
    out.push({
      canonicalName: c.canonicalName,
      displayLabel: c.displayLabel,
      count,
      singular,
      plural,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Slot composition
// ---------------------------------------------------------------------------

function makeNavigateLine(
  theme: MazeHuntTheme,
  collectible: NormalizedCollectible,
): string {
  // The theme's collectTemplate is biome-specific (e.g. "Navigate to all
  // {count} ender crystals." for End Island). For multi-item themes the
  // template usually only mentions one collectible, so for the second-item
  // line we fall back to a generic "Collect {count} {item-plural}." form.
  const template = theme.collectibles[0]?.canonicalName === collectible.canonicalName
    ? theme.objectives.collectTemplate
    : `Collect {count} {item-plural}.`;
  return interpolate(template, {
    count: collectible.count,
    itemSingular: collectible.singular,
    itemPlural: collectible.plural,
  });
}

function makeBossLine(theme: MazeHuntTheme): string {
  return interpolate(theme.objectives.bossTemplate, {
    boss: theme.boss.displayLabel,
  });
}

function makeEscapeLine(theme: MazeHuntTheme): string {
  return interpolate(theme.objectives.escapeTemplate, {});
}

function makeCraftLine(
  theme: MazeHuntTheme,
  assembly: Assembly | undefined,
  collectibles: NormalizedCollectible[],
  catalog: CatalogLookup,
): { text: string; slot: "craft" | "state-change" } {
  // Use the theme-supplied template verbatim — Andrew has tuned each one.
  const template = theme.objectives.assembleTemplate;

  // Pick an item-singular / item-plural that fits the assembly's cutout item.
  let itemSingular: string | undefined;
  let itemPlural: string | undefined;
  if (assembly && assembly.cutoutPanel.length > 0) {
    const first = assembly.cutoutPanel[0];
    if (first) {
      const asset = catalog.findAsset(first.item);
      if (asset) {
        itemSingular = lower(assetSingular(asset));
        itemPlural = lower(assetPlural(asset, 2));
      }
    }
  }
  // Fall back to the first collectible if no assembly cutout is available.
  if (itemSingular === undefined && collectibles.length > 0) {
    const c = collectibles[0];
    if (c) {
      itemSingular = c.singular;
      itemPlural = c.plural;
    }
  }

  const targetName = assembly?.displayName ?? "template";
  const text = interpolate(template, {
    itemSingular,
    itemPlural,
    target: lower(targetName),
  });
  const slot: "craft" | "state-change" =
    assembly?.hasStateChange === true ? "state-change" : "craft";
  return { text, slot };
}

// Find the first integer in a string, or null. Used to compare an override's
// literal count against the live placement count.
function firstIntegerIn(text: string): number | null {
  const m = text.match(/-?\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  return n;
}

function applyOverrideIfPresent(
  base: Objective,
  overrides: Partial<Record<ObjectiveSlot, string>> | undefined,
  expectedCount: number | null,
): Objective {
  const override = overrides?.[base.slot];
  if (override === undefined) return base;
  const trimmed = override.trim();
  if (trimmed.length === 0) return base;
  const result: Objective = {
    slot: base.slot,
    text: trimmed,
    isOverride: true,
  };
  if (expectedCount !== null) {
    const found = firstIntegerIn(trimmed);
    if (found !== expectedCount) {
      result.countMismatch = {
        expected: expectedCount,
        foundInOverride: found,
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function composeObjectives(input: ComposeObjectivesInput): Objective[] {
  const collectibles = normalizeCollectibles(
    input.theme,
    input.placementsByItem,
    input.catalog,
  );

  const objectives: Objective[] = [];

  // Navigate slot — one line per collectible group.
  // For multi-item themes we use only ONE override slot ("navigate") that
  // applies to the first navigate line only; the others remain auto-derived.
  // This keeps the override map flat without leaking into the overrides
  // type. (Multi-line override is a v2 feature.)
  if (collectibles.length === 0) {
    // No collectibles in the theme — fall back to the single template with
    // count=0 so downstream still has a navigate line for the override slot.
    const navigate: Objective = {
      slot: "navigate",
      text: interpolate(input.theme.objectives.collectTemplate, { count: 0 }),
      isOverride: false,
    };
    objectives.push(applyOverrideIfPresent(navigate, input.overrides, 0));
  } else {
    let isFirst = true;
    for (const collectible of collectibles) {
      const text = makeNavigateLine(input.theme, collectible);
      const navigate: Objective = {
        slot: "navigate",
        text,
        isOverride: false,
      };
      if (isFirst) {
        objectives.push(
          applyOverrideIfPresent(navigate, input.overrides, collectible.count),
        );
        isFirst = false;
      } else {
        objectives.push(navigate);
      }
    }
  }

  // Find slot — the boss line.
  const findLine: Objective = {
    slot: "find",
    text: makeBossLine(input.theme),
    isOverride: false,
  };
  objectives.push(applyOverrideIfPresent(findLine, input.overrides, null));

  // Escape slot.
  const escapeLine: Objective = {
    slot: "escape",
    text: makeEscapeLine(input.theme),
    isOverride: false,
  };
  objectives.push(applyOverrideIfPresent(escapeLine, input.overrides, null));

  // Craft / state-change slot — terminal, always present.
  const craft = makeCraftLine(
    input.theme,
    input.assembly,
    collectibles,
    input.catalog,
  );
  const craftBase: Objective = {
    slot: craft.slot,
    text: craft.text,
    isOverride: false,
  };
  objectives.push(applyOverrideIfPresent(craftBase, input.overrides, null));

  return objectives;
}
