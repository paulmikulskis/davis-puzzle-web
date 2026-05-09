/**
 * Developer-time catalog builder.
 *
 * Scrapes minecraft.wiki for a curated set of items and emits:
 *   public/items.json                    -- catalog satisfying CatalogFile schema
 *   public/items/<canonical_lowercase>.png -- 16x16 thumbnail per item
 *
 * Run with:
 *   pnpm catalog:build
 * or:
 *   pnpm tsx scripts/build-catalog.ts
 *
 * Politeness: at most 4 concurrent fetches, ~150ms spacing per request.
 * Disk cache under .cache/wiki/<filename> makes re-runs cheap.
 */

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  CATALOG_SCHEMA_VERSION,
  isCatalogFile,
  type CatalogCategory,
  type CatalogFile,
  type CatalogItem,
} from "../lib/catalog";
import { extractPaletteFromImageData } from "../lib/palette";
import { computeDifficulty } from "../lib/difficulty";
import { asImageData, decodePngToImageData } from "../lib/nodeImageData";

/** maxColors used by the page UI by default (see app/page.tsx slider default). */
const DIFFICULTY_MAX_COLORS = 8;

const USER_AGENT = "DavisPuzzleWeb/1.0 (OT therapy worksheets)";
const REPO_ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(REPO_ROOT, ".cache", "wiki");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const ITEMS_DIR = path.join(PUBLIC_DIR, "items");
const CATALOG_PATH = path.join(PUBLIC_DIR, "items.json");

const MAX_CONCURRENCY = 4;
const REQUEST_SPACING_MS = 150;

const ARTICLE_ICON_RE =
  /\/images\/(?:thumb\/[^/]+\/[^/]+\/)?(Invicon_[A-Za-z0-9_()]+\.png)/g;

/** Curated seed list. Each entry is wiki-canonical (underscored, title-cased). */
const SEEDS: Record<CatalogCategory, string[]> = {
  food: [
    "Apple",
    "Cooked_Salmon",
    "Cooked_Beef",
    "Bread",
    "Carrot",
    "Potato",
    "Cookie",
    "Pumpkin_Pie",
    "Cake",
    "Sweet_Berries",
    "Honey_Bottle",
    "Golden_Apple",
    "Glow_Berries",
    "Melon_Slice",
    "Cooked_Chicken",
    "Cooked_Mutton",
    "Cooked_Porkchop",
    "Cooked_Rabbit",
    "Cooked_Cod",
    "Pufferfish",
    "Tropical_Fish_(Item)",
    "Salmon_(Item)",
    "Cod_(Item)",
    "Beetroot",
    "Beetroot_Soup",
    "Mushroom_Stew",
    "Rabbit_Stew",
    "Suspicious_Stew",
    "Chorus_Fruit",
    "Dried_Kelp",
  ],
  tool: [
    "Iron_Pickaxe",
    "Iron_Axe",
    "Iron_Shovel",
    "Iron_Hoe",
    "Iron_Sword",
    "Diamond_Pickaxe",
    "Diamond_Sword",
    "Golden_Pickaxe",
    "Wooden_Pickaxe",
    "Stone_Pickaxe",
    "Netherite_Pickaxe",
    "Bow",
    "Crossbow",
    "Trident",
    "Shears",
    "Fishing_Rod",
    "Flint_and_Steel",
    "Compass",
    "Clock",
    "Spyglass",
  ],
  ingot: [
    "Iron_Ingot",
    "Gold_Ingot",
    "Copper_Ingot",
    "Netherite_Ingot",
    "Iron_Nugget",
    "Gold_Nugget",
    "Raw_Iron",
    "Raw_Gold",
    "Raw_Copper",
  ],
  gem: [
    "Diamond",
    "Emerald",
    "Lapis_Lazuli",
    "Amethyst_Shard",
    "Quartz",
    "Prismarine_Crystals",
    "Prismarine_Shard",
  ],
  "mob-drop": [
    "Bone",
    "String",
    "Feather",
    "Leather",
    "Gunpowder",
    "Spider_Eye",
    "Rotten_Flesh",
    "Slime_Ball",
    "Magma_Cream",
    "Blaze_Rod",
    "Ghast_Tear",
    "Ender_Pearl",
    "Phantom_Membrane",
    "Rabbit_Hide",
    "Rabbit's_Foot",
    "Egg",
    "Ink_Sac",
    "Glow_Ink_Sac",
  ],
  plant: [
    "Wheat",
    "Wheat_Seeds",
    "Sugar_Cane",
    "Bamboo",
    "Cactus",
    "Kelp",
    "Pumpkin_Seeds",
    "Melon_Seeds",
    "Beetroot_Seeds",
    "Cocoa_Beans",
    "Nether_Wart",
    "Glow_Lichen",
    "Fern",
    "Vines",
    "Lily_Pad",
  ],
  mineral: [
    "Coal",
    "Charcoal",
    "Redstone",
    "Glowstone_Dust",
    "Flint",
    "Clay_Ball",
    "Brick",
    "Nether_Brick_(Item)",
    "Sugar",
  ],
  dye: [
    "White_Dye",
    "Red_Dye",
    "Blue_Dye",
    "Green_Dye",
    "Yellow_Dye",
    "Black_Dye",
    "Pink_Dye",
    "Cyan_Dye",
    "Lime_Dye",
    "Magenta_Dye",
    "Orange_Dye",
    "Purple_Dye",
    "Brown_Dye",
    "Light_Blue_Dye",
    "Light_Gray_Dye",
    "Gray_Dye",
  ],
  misc: [
    "Stick",
    "Bone_Meal",
    "Paper",
    "Book",
    "Saddle",
    "Lead",
    "Music_Disc_13",
    "Bucket",
    "Water_Bucket",
    "Lava_Bucket",
    "Milk_Bucket",
    "Snowball",
    "Arrow",
    "Spectral_Arrow",
  ],
};

interface ResolvedItem {
  canonical: string;
  category: CatalogCategory;
  sourceFilename: string;
  bytes: Uint8Array;
}

interface SkippedItem {
  canonical: string;
  category: CatalogCategory;
  reason: string;
}

/** Throttle to keep ~150ms spacing between requests. */
class Throttle {
  private last = 0;
  async wait(ms: number) {
    const now = Date.now();
    const wait = Math.max(0, this.last + ms - now);
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }
}
const throttle = new Throttle();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true });
}

function cacheKeyForImage(filename: string) {
  return path.join(CACHE_DIR, `image_${filename}`);
}
function cacheKeyForArticle(article: string) {
  // sanitize parens for filesystem clarity
  const safe = article.replace(/[^A-Za-z0-9_()'-]/g, "_");
  return path.join(CACHE_DIR, `article_${safe}.html`);
}
function cacheKeyForMissing(kind: "image" | "article", key: string) {
  const safe = key.replace(/[^A-Za-z0-9_()'-]/g, "_");
  return path.join(CACHE_DIR, `${kind}_${safe}.404`);
}

async function fetchImageBytes(filename: string): Promise<Uint8Array | null> {
  const cachePath = cacheKeyForImage(filename);
  const missPath = cacheKeyForMissing("image", filename);
  if (existsSync(cachePath)) {
    const buf = await readFile(cachePath);
    return new Uint8Array(buf);
  }
  if (existsSync(missPath)) {
    return null;
  }

  await throttle.wait(REQUEST_SPACING_MS);
  const url = `https://minecraft.wiki/images/${encodeURIComponent(filename)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store" as RequestCache,
  });
  if (res.status === 404) {
    await ensureDir(path.dirname(missPath));
    await writeFile(missPath, "");
    return null;
  }
  if (!res.ok) {
    throw new Error(`image fetch ${filename} failed http ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  await ensureDir(path.dirname(cachePath));
  await writeFile(cachePath, buf);
  return buf;
}

async function fetchArticleHtml(article: string): Promise<string | null> {
  const cachePath = cacheKeyForArticle(article);
  const missPath = cacheKeyForMissing("article", article);
  if (existsSync(cachePath)) {
    return readFile(cachePath, "utf8");
  }
  if (existsSync(missPath)) {
    return null;
  }

  await throttle.wait(REQUEST_SPACING_MS);
  const url = `https://minecraft.wiki/w/${encodeURIComponent(article)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store" as RequestCache,
  });
  if (res.status === 404) {
    await ensureDir(path.dirname(missPath));
    await writeFile(missPath, "");
    return null;
  }
  if (!res.ok) {
    throw new Error(`article fetch ${article} failed http ${res.status}`);
  }
  const html = await res.text();
  await ensureDir(path.dirname(cachePath));
  await writeFile(cachePath, html, "utf8");
  return html;
}

function pickArticleIcon(html: string, canonical: string): string | null {
  const canonicalToken = canonical.toLowerCase();
  const matches = Array.from(html.matchAll(ARTICLE_ICON_RE), (m, index) => ({
    filename: m[1],
    index,
  }));
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const aHas = a.filename.toLowerCase().includes(canonicalToken) ? 1 : 0;
    const bHas = b.filename.toLowerCase().includes(canonicalToken) ? 1 : 0;
    return (
      bHas - aHas ||
      a.filename.length - b.filename.length ||
      a.index - b.index
    );
  });
  return matches[0].filename;
}

async function resolveItem(
  canonical: string,
  category: CatalogCategory,
): Promise<ResolvedItem | { skipped: SkippedItem }> {
  // Strip _(Item) suffix when probing direct filenames since the wiki tends
  // to use the bare canonical form for the file itself. Keep the raw form too
  // as a fallback.
  const stripped = canonical.replace(/_\(.+\)$/, "");
  const candidates = uniq([
    `Invicon_${canonical}.png`,
    `Invicon_${stripped}.png`,
    `Invicon_Raw_${canonical}.png`,
    `Invicon_Raw_${stripped}.png`,
    `Invicon_Cooked_${canonical}.png`,
    `Invicon_Cooked_${stripped}.png`,
    `Invicon_Nether_${canonical}.png`,
    `Invicon_Nether_${stripped}.png`,
  ]);

  for (const filename of candidates) {
    try {
      const bytes = await fetchImageBytes(filename);
      if (bytes) {
        return { canonical, category, sourceFilename: filename, bytes };
      }
    } catch (err) {
      return {
        skipped: {
          canonical,
          category,
          reason: `image fetch error: ${(err as Error).message}`,
        },
      };
    }
  }

  // Fallback: scrape article for an Invicon reference.
  try {
    const html = await fetchArticleHtml(canonical);
    if (!html) {
      return {
        skipped: { canonical, category, reason: "article 404 and no direct icon" },
      };
    }
    const scraped = pickArticleIcon(html, canonical);
    if (!scraped) {
      return {
        skipped: { canonical, category, reason: "article had no Invicon image" },
      };
    }
    const bytes = await fetchImageBytes(scraped);
    if (!bytes) {
      return {
        skipped: { canonical, category, reason: `scraped icon 404: ${scraped}` },
      };
    }
    return { canonical, category, sourceFilename: scraped, bytes };
  } catch (err) {
    return {
      skipped: {
        canonical,
        category,
        reason: `article fetch error: ${(err as Error).message}`,
      },
    };
  }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function computeDifficultyFlags(
  item: ResolvedItem,
): CatalogItem["flags"] {
  try {
    const imageData = asImageData(decodePngToImageData(item.bytes));
    const { palette } = extractPaletteFromImageData(
      imageData,
      DIFFICULTY_MAX_COLORS,
    );
    const result = computeDifficulty(palette);
    return {
      difficulty: result.bucket,
      difficultyExplanation: result.explanation,
    };
  } catch (err) {
    console.warn(
      `  [difficulty] could not compute for ${item.canonical}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

function humanize(canonical: string): string {
  // "Tropical_Fish_(Item)" -> "Tropical Fish"
  // "Cooked_Salmon" -> "Cooked Salmon"
  return canonical
    .replace(/_\(.+\)$/, "")
    .replaceAll("_", " ")
    .trim();
}

function thumbnailFilename(canonical: string): string {
  // Filesystem-safe lowercase canonical. Drop parentheses so we don't ship
  // funky paths in /public.
  return canonical.toLowerCase().replace(/[()]/g, "").replace(/'/g, "");
}

async function runWithConcurrency<T, R>(
  inputs: T[],
  worker: (input: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(inputs.length);
  let cursor = 0;
  async function next(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= inputs.length) return;
      results[i] = await worker(inputs[i]);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, inputs.length) }, () =>
    next(),
  );
  await Promise.all(runners);
  return results;
}

async function main() {
  console.log("Davis Puzzle catalog builder");
  console.log("============================");

  await ensureDir(CACHE_DIR);
  await ensureDir(ITEMS_DIR);

  // Flatten seeds into work items, preserving exact category assignment.
  const work: { canonical: string; category: CatalogCategory }[] = [];
  for (const [category, items] of Object.entries(SEEDS) as [
    CatalogCategory,
    string[],
  ][]) {
    for (const canonical of items) {
      work.push({ canonical, category });
    }
  }
  console.log(`Seed list: ${work.length} items across ${Object.keys(SEEDS).length} categories.`);

  const results = await runWithConcurrency(
    work,
    (job) => resolveItem(job.canonical, job.category),
    MAX_CONCURRENCY,
  );

  const resolved: ResolvedItem[] = [];
  const skipped: SkippedItem[] = [];
  for (const r of results) {
    if ("skipped" in r) skipped.push(r.skipped);
    else resolved.push(r);
  }

  // Write thumbnail PNGs.
  let thumbsWritten = 0;
  for (const item of resolved) {
    const filename = thumbnailFilename(item.canonical) + ".png";
    const fsPath = path.join(ITEMS_DIR, filename);
    await writeFile(fsPath, item.bytes);
    thumbsWritten++;
  }

  // Build catalog file. Compute difficulty per item using the same pipeline
  // the browser uses at runtime (palette extraction at maxColors=8, then
  // computeDifficulty on the resulting palette). If difficulty fails for some
  // unusual texture, log it and leave the flag unset rather than aborting the
  // whole build.
  const catalogItems: CatalogItem[] = resolved.map((r) => {
    const flags = computeDifficultyFlags(r);
    return {
      canonicalName: r.canonical,
      displayName: humanize(r.canonical),
      sourceFilename: r.sourceFilename,
      categories: [r.category],
      thumbnailPath: `/items/${thumbnailFilename(r.canonical)}.png`,
      flags,
    };
  });

  // Stable order: by category-as-seeded, then by canonicalName.
  const categoryOrder = (Object.keys(SEEDS) as CatalogCategory[]).reduce(
    (acc, cat, idx) => {
      acc[cat] = idx;
      return acc;
    },
    {} as Record<CatalogCategory, number>,
  );
  catalogItems.sort((a, b) => {
    const ca = a.categories[0];
    const cb = b.categories[0];
    return (
      (categoryOrder[ca] ?? 99) - (categoryOrder[cb] ?? 99) ||
      a.canonicalName.localeCompare(b.canonicalName)
    );
  });

  const catalog: CatalogFile = {
    _schema: CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    itemCount: catalogItems.length,
    items: catalogItems,
  };

  if (!isCatalogFile(catalog)) {
    throw new Error("internal: produced catalog does not pass isCatalogFile()");
  }

  // Confirm every thumbnailPath exists on disk.
  for (const item of catalog.items) {
    const onDisk = path.join(PUBLIC_DIR, item.thumbnailPath.replace(/^\//, ""));
    const st = await stat(onDisk).catch(() => null);
    if (!st || !st.isFile()) {
      throw new Error(`thumbnail missing on disk: ${onDisk}`);
    }
  }

  await writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  // Summary.
  const perCat = new Map<CatalogCategory, number>();
  for (const item of catalog.items) {
    const c = item.categories[0];
    perCat.set(c, (perCat.get(c) ?? 0) + 1);
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`Resolved items:   ${catalog.items.length}`);
  console.log(`Thumbnails written: ${thumbsWritten}`);
  console.log(`Skipped items:    ${skipped.length}`);
  console.log("Per-category counts:");
  for (const cat of Object.keys(SEEDS) as CatalogCategory[]) {
    console.log(`  ${cat.padEnd(10)} ${perCat.get(cat) ?? 0}`);
  }

  // Difficulty distribution across the catalog. Helpful sanity check after
  // tuning thresholds in lib/difficulty.ts — if everything ends up "hard",
  // the threshold knobs need attention.
  const perDifficulty = new Map<string, number>();
  let missing = 0;
  for (const item of catalog.items) {
    const d = item.flags?.difficulty;
    if (typeof d === "string") {
      perDifficulty.set(d, (perDifficulty.get(d) ?? 0) + 1);
    } else {
      missing += 1;
    }
  }
  console.log("Per-difficulty counts:");
  for (const bucket of ["easy", "medium", "hard"]) {
    console.log(`  ${bucket.padEnd(10)} ${perDifficulty.get(bucket) ?? 0}`);
  }
  if (missing > 0) {
    console.log(`  (missing) ${missing}`);
  }
  if (skipped.length > 0) {
    console.log("");
    console.log("Skipped:");
    for (const s of skipped) {
      console.log(`  - [${s.category}] ${s.canonical}: ${s.reason}`);
    }
  }
  console.log("");
  console.log(`Wrote ${CATALOG_PATH}`);
  if (catalog.items.length < 100) {
    console.error(
      `WARNING: only ${catalog.items.length} items resolved; threshold is 100.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Catalog build failed:", err);
  process.exit(1);
});
