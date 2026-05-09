// Static catalog of browseable Minecraft items. Built at developer time by
// scripts/build-catalog.ts (which scrapes minecraft.wiki) and emitted to
// public/items.json. Loaded by the page on demand, never at runtime against
// the wiki.

export const CATALOG_SCHEMA_VERSION = 1;

export type CatalogCategory =
  | "food"
  | "tool"
  | "ingot"
  | "gem"
  | "mob-drop"
  | "plant"
  | "mineral"
  | "dye"
  | "misc";

export interface CatalogItem {
  /** Wiki-canonical item name with underscores (e.g. "Cooked_Salmon"). */
  canonicalName: string;
  /** Human display name (e.g. "Cooked Salmon"). */
  displayName: string;
  /** Wiki source filename (e.g. "Invicon_Cooked_Salmon.png"). */
  sourceFilename: string;
  /** One or more coarse categories. */
  categories: CatalogCategory[];
  /** Path under public/, e.g. /items/cooked_salmon.png. */
  thumbnailPath: string;
  /** Free-form flags. Reserved for future signals (e.g. difficulty bucket). */
  flags?: Record<string, string | number | boolean>;
}

export interface CatalogFile {
  _schema: number;
  generatedAt: string;
  itemCount: number;
  items: CatalogItem[];
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
};

export function isCatalogItem(value: unknown): value is CatalogItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CatalogItem>;
  return (
    typeof item.canonicalName === "string" &&
    typeof item.displayName === "string" &&
    typeof item.sourceFilename === "string" &&
    Array.isArray(item.categories) &&
    typeof item.thumbnailPath === "string"
  );
}

export function isCatalogFile(value: unknown): value is CatalogFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<CatalogFile>;
  return (
    file._schema === CATALOG_SCHEMA_VERSION &&
    typeof file.generatedAt === "string" &&
    Array.isArray(file.items) &&
    file.items.every(isCatalogItem)
  );
}
