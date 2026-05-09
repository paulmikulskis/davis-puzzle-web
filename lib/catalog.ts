// Static catalog of browseable Minecraft assets. Built at developer time by
// scripts/build-catalog.ts (which scrapes minecraft.wiki) and emitted to
// public/items.json. Loaded by the page on demand, never at runtime against
// the wiki.
//
// Schema v2 (Maze Hunt foundation): items, blocks, and entities live side-by-
// side in one file. Pixel Puzzle reads only the `items: [...]` slice and is
// unchanged from v1.

export const CATALOG_SCHEMA_VERSION = 2;

export type CatalogCategory =
  // Pixel Puzzle (v1) categories
  | "food"
  | "tool"
  | "ingot"
  | "gem"
  | "mob-drop"
  | "plant"
  | "mineral"
  | "dye"
  | "misc"
  // Maze Hunt block / theme tags
  | "block"
  | "ocean"
  | "nether"
  | "end"
  | "ancient-city"
  | "overworld"
  // Maze Hunt entity tags
  | "entity"
  | "boss"
  | "neutral"
  | "hostile";

export type CatalogAssetKind = "item" | "block" | "entity";

interface BaseAsset {
  /** Wiki-canonical name with underscores (e.g. "Cooked_Salmon"). */
  canonicalName: string;
  /** Human display name in singular form (e.g. "Cooked Salmon"). */
  displayName: string;
  /** Wiki source filename (e.g. "Invicon_Cooked_Salmon.png"). */
  sourceFilename: string;
  /** One or more coarse categories. */
  categories: CatalogCategory[];
  /** Path under public/, e.g. /items/cooked_salmon.png. */
  thumbnailPath: string;
  /** Free-form flags. v1 difficulty flags persist on items. */
  flags?: Record<string, string | number | boolean>;

  // Pluralization fields used by Maze Hunt objective phrasing (Feature 6).
  /** Singular display form for prompts. Default: same as displayName. */
  displayNameSingular?: string;
  /** Plural display form for prompts. Default: derived from singular by adding "s". */
  displayNamePlural?: string;
  /** Mass noun (e.g. "soul sand"): pluralizes as "blocks of soul sand". */
  massNoun?: boolean;
  /** Explicit override for the plural form when ad-hoc rules don't fit. */
  pluralOverride?: string;
}

/** Inventory icon. Pixel-puzzle product reads these. */
export interface CatalogItemAsset extends BaseAsset {
  kind: "item";
  /** Always 16×16 in source. */
  displayPixelSize: 16;
}

/** Placeable block. Same Invicon_* pattern in most cases, but some entries
 *  (Sculk, Sea Lantern, End Crystal, Prismarine) use entity-style filenames. */
export interface CatalogBlockAsset extends BaseAsset {
  kind: "block";
  /** Always 16×16 in source for blocks (we resample non-Invicon files down). */
  displayPixelSize: 16;
  /** True if this block is allowed as a paste-target tile in Maze Hunt assemblies. */
  isPlaceableInAssembly: boolean;
}

/** Entity / mob portrait. Larger source image, usually 100–800 px. */
export interface CatalogEntityAsset extends BaseAsset {
  kind: "entity";
  /** Recommended display size in printed/preview output (px square, ~64–256). */
  defaultDisplaySize: number;
  /** True if the source wiki image is animated (GIF). Build extracts frame 0. */
  sourceIsAnimated: boolean;
  /** Native dimensions of the source image, captured at build time for sanity. */
  sourceWidthPx: number;
  sourceHeightPx: number;
}

export type CatalogAsset =
  | CatalogItemAsset
  | CatalogBlockAsset
  | CatalogEntityAsset;

/** v1 alias preserved so existing pixel-puzzle product imports keep compiling. */
export type CatalogItem = CatalogItemAsset;

export interface CatalogFile {
  _schema: number;
  generatedAt: string;
  /** Legacy: count of kind="item" only, for v1 readers. */
  itemCount: number;
  /** Total across all kinds. */
  assetCount: number;
  /** v1-shaped slice; same array v1 readers used. */
  items: CatalogItemAsset[];
  blocks: CatalogBlockAsset[];
  entities: CatalogEntityAsset[];
}

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  food: "Food",
  tool: "Tools",
  ingot: "Ingots",
  gem: "Gems",
  "mob-drop": "Mob drops",
  plant: "Plants",
  mineral: "Minerals",
  dye: "Dyes",
  misc: "Misc",
  block: "Blocks",
  ocean: "Ocean",
  nether: "Nether",
  end: "End",
  "ancient-city": "Ancient City",
  overworld: "Overworld",
  entity: "Entities",
  boss: "Bosses",
  neutral: "Neutral mobs",
  hostile: "Hostile mobs",
};

function isCatalogCategory(value: unknown): value is CatalogCategory {
  return typeof value === "string" && value in CATEGORY_LABELS;
}

function hasBaseShape(value: unknown): value is BaseAsset & { kind: unknown } {
  if (!value || typeof value !== "object") return false;
  const a = value as Partial<BaseAsset> & { kind?: unknown };
  return (
    typeof a.canonicalName === "string" &&
    typeof a.displayName === "string" &&
    typeof a.sourceFilename === "string" &&
    Array.isArray(a.categories) &&
    a.categories.every(isCatalogCategory) &&
    typeof a.thumbnailPath === "string"
  );
}

export function isCatalogItem(value: unknown): value is CatalogItemAsset {
  if (!hasBaseShape(value)) return false;
  // v1 entries that have no `kind` field still satisfy this — treat them as
  // items defensively. v2 entries always carry kind === "item".
  const kind = (value as { kind?: unknown }).kind;
  if (kind !== undefined && kind !== "item") return false;
  return true;
}

export function isCatalogBlock(value: unknown): value is CatalogBlockAsset {
  if (!hasBaseShape(value)) return false;
  const block = value as Partial<CatalogBlockAsset>;
  return (
    block.kind === "block" &&
    typeof block.isPlaceableInAssembly === "boolean"
  );
}

export function isCatalogEntity(value: unknown): value is CatalogEntityAsset {
  if (!hasBaseShape(value)) return false;
  const entity = value as Partial<CatalogEntityAsset>;
  return (
    entity.kind === "entity" &&
    typeof entity.defaultDisplaySize === "number" &&
    typeof entity.sourceIsAnimated === "boolean" &&
    typeof entity.sourceWidthPx === "number" &&
    typeof entity.sourceHeightPx === "number"
  );
}

export function isCatalogFile(value: unknown): value is CatalogFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<CatalogFile>;
  return (
    typeof file._schema === "number" &&
    typeof file.generatedAt === "string" &&
    Array.isArray(file.items) &&
    file.items.every(isCatalogItem) &&
    // v1 files have no blocks/entities arrays. v2 files require them.
    (file._schema < 2 ||
      (Array.isArray(file.blocks) &&
        file.blocks.every(isCatalogBlock) &&
        Array.isArray(file.entities) &&
        file.entities.every(isCatalogEntity)))
  );
}

/** Human-readable singular form for an asset, defaulting to displayName. */
export function assetSingular(asset: CatalogAsset): string {
  return asset.displayNameSingular ?? asset.displayName;
}

/** Human-readable plural form for an asset, with mass-noun + override support. */
export function assetPlural(
  asset: CatalogAsset,
  count: number,
): string {
  if (asset.pluralOverride) return asset.pluralOverride;
  const singular = assetSingular(asset);
  if (count === 1) return singular;
  if (asset.massNoun) {
    const measure = count === 1 ? "block" : "blocks";
    return `${measure} of ${singular}`;
  }
  if (asset.displayNamePlural) return asset.displayNamePlural;
  // Default ad-hoc pluralization: apply trailing "s".
  if (/(s|sh|ch|x|z)$/i.test(singular)) return `${singular}es`;
  if (/[^aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
  return `${singular}s`;
}
