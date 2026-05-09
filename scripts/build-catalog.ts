/**
 * Developer-time catalog builder.
 *
 * Scrapes minecraft.wiki for a curated set of items, blocks, and entities and
 * emits a v2 catalog file:
 *
 *   public/items.json                       -- catalog with items[], blocks[], entities[]
 *   public/items/<canonical_lowercase>.png    -- 16x16 thumbnail per item
 *   public/blocks/<canonical_lowercase>.png   -- 16x16 thumbnail per block
 *   public/entities/<canonical_lowercase>.png -- ~160-200px portrait per entity
 *
 * Run with:
 *   pnpm catalog:build
 *
 * Politeness: at most 4 concurrent fetches, ~150ms spacing per request.
 * Disk cache under .cache/wiki/<filename> makes re-runs cheap.
 */

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { parseGIF, decompressFrames } from "gifuct-js";
import {
  CATALOG_SCHEMA_VERSION,
  isCatalogFile,
  type CatalogAsset,
  type CatalogBlockAsset,
  type CatalogCategory,
  type CatalogEntityAsset,
  type CatalogFile,
  type CatalogItemAsset,
} from "../lib/catalog";
import { extractPaletteFromImageData } from "../lib/palette";
import { computeDifficulty } from "../lib/difficulty";
import { asImageData, decodePngToImageData } from "../lib/nodeImageData";

const DIFFICULTY_MAX_COLORS = 8;

const USER_AGENT = "DavisPuzzleWeb/1.0 (OT therapy worksheets)";
const REPO_ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(REPO_ROOT, ".cache", "wiki");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const ITEMS_DIR = path.join(PUBLIC_DIR, "items");
const BLOCKS_DIR = path.join(PUBLIC_DIR, "blocks");
const ENTITIES_DIR = path.join(PUBLIC_DIR, "entities");
const CATALOG_PATH = path.join(PUBLIC_DIR, "items.json");

const MAX_CONCURRENCY = 4;
const REQUEST_SPACING_MS = 150;

const ARTICLE_ICON_RE =
  /\/images\/(?:thumb\/[^/]+\/[^/]+\/)?(Invicon_[A-Za-z0-9_()]+\.png)/g;

/** Items: Pixel Puzzle catalog, unchanged from v1. */
const ITEM_SEEDS: Record<CatalogCategory, string[]> = {
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
  // The remaining categories are Maze Hunt-specific and have no item seeds.
  block: [],
  ocean: [],
  nether: [],
  end: [],
  "ancient-city": [],
  overworld: [],
  entity: [],
  boss: [],
  neutral: [],
  hostile: [],
};

interface PluralOpts {
  displayNameSingular?: string;
  displayNamePlural?: string;
  massNoun?: boolean;
  pluralOverride?: string;
}

interface BlockSeed extends PluralOpts {
  canonical: string;
  categories: CatalogCategory[];
  /** When the wiki has no Invicon_* file, declare the source filename. */
  sourceFilenameOverride?: string;
  /** Default true. Some blocks (Obsidian, End_Stone) are decorative-only. */
  isPlaceableInAssembly?: boolean;
  /** Override the default display name (humanized canonical). */
  displayNameOverride?: string;
}

interface EntitySeed extends PluralOpts {
  canonical: string;
  categories: CatalogCategory[];
  /** Always explicit — JE/BE suffix isn't derivable. */
  sourceFilename: string;
  /** Output portrait size (px square). Default 200. */
  defaultDisplaySize?: number;
  displayNameOverride?: string;
}

const BLOCK_SEEDS: BlockSeed[] = [
  // Ocean Monument
  {
    canonical: "Sponge",
    categories: ["block", "ocean"],
    isPlaceableInAssembly: true,
  },
  {
    canonical: "Wet_Sponge",
    categories: ["block", "ocean"],
    isPlaceableInAssembly: true,
  },
  { canonical: "Prismarine_Bricks", categories: ["block", "ocean"] },
  { canonical: "Dark_Prismarine", categories: ["block", "ocean"] },
  { canonical: "Sea_Pickle", categories: ["block", "ocean"] },
  {
    canonical: "Prismarine",
    categories: ["block", "ocean"],
    sourceFilenameOverride: "Prismarine_JE2_BE2.png",
  },
  {
    canonical: "Sea_Lantern",
    categories: ["block", "ocean"],
    sourceFilenameOverride: "Sea_Lantern_JE1_BE1.png",
  },

  // Nether
  {
    canonical: "Soul_Sand",
    categories: ["block", "nether"],
    isPlaceableInAssembly: true,
    massNoun: true,
    displayNameSingular: "soul sand",
  },
  { canonical: "Soul_Soil", categories: ["block", "nether"], massNoun: true },
  {
    canonical: "Wither_Skeleton_Skull",
    categories: ["block", "nether", "mob-drop"],
    isPlaceableInAssembly: true,
    displayNameSingular: "wither skull",
    displayNamePlural: "wither skulls",
  },
  { canonical: "Netherrack", categories: ["block", "nether"] },
  { canonical: "Soul_Torch", categories: ["block", "nether"] },
  { canonical: "Glowstone", categories: ["block", "nether"] },
  { canonical: "Crying_Obsidian", categories: ["block", "end", "nether"] },

  // End Island
  {
    canonical: "Obsidian",
    categories: ["block", "end"],
    isPlaceableInAssembly: true,
  },
  {
    canonical: "Ladder",
    categories: ["block", "misc"],
    isPlaceableInAssembly: true,
  },
  { canonical: "End_Stone", categories: ["block", "end"] },
  { canonical: "End_Stone_Bricks", categories: ["block", "end"] },
  { canonical: "End_Rod", categories: ["block", "end"] },
  { canonical: "Chorus_Flower", categories: ["block", "end"] },
  { canonical: "Purpur_Block", categories: ["block", "end"] },
  { canonical: "Dragon_Egg", categories: ["block", "end"] },
  {
    canonical: "End_Crystal",
    categories: ["block", "end"],
    isPlaceableInAssembly: true,
    displayNameSingular: "ender crystal",
    displayNamePlural: "ender crystals",
  },

  // Ancient City / overworld
  {
    canonical: "Sculk",
    categories: ["block", "ancient-city"],
    sourceFilenameOverride: "Sculk_JE1_BE1.png",
  },
  { canonical: "Cobblestone", categories: ["block", "overworld"] },
  { canonical: "Stone", categories: ["block", "overworld"] },
  { canonical: "Oak_Planks", categories: ["block", "overworld"] },
  { canonical: "Hay_Bale", categories: ["block", "overworld"] },
  { canonical: "Pumpkin", categories: ["block", "overworld"] },
];

const ENTITY_SEEDS: EntitySeed[] = [
  // Bosses
  {
    canonical: "Ender_Dragon",
    categories: ["entity", "boss", "end"],
    sourceFilename: "Ender_Dragon.gif",
    defaultDisplaySize: 200,
  },
  {
    canonical: "Wither",
    categories: ["entity", "boss", "nether"],
    sourceFilename: "Wither_JE2_BE2.png",
    defaultDisplaySize: 180,
  },
  {
    canonical: "Elder_Guardian",
    categories: ["entity", "boss", "ocean"],
    sourceFilename: "Elder_Guardian.png",
    defaultDisplaySize: 160,
  },
  {
    canonical: "Warden",
    categories: ["entity", "boss", "ancient-city"],
    sourceFilename: "Warden.png",
    defaultDisplaySize: 180,
  },
  // Centerpieces / neutrals
  {
    canonical: "Iron_Golem",
    categories: ["entity", "neutral", "overworld"],
    sourceFilename: "Iron_Golem.png",
    defaultDisplaySize: 160,
  },
  {
    canonical: "Snow_Golem",
    categories: ["entity", "neutral", "overworld"],
    sourceFilename: "Snow_Golem.png",
    defaultDisplaySize: 140,
  },
  {
    canonical: "Allay",
    categories: ["entity", "neutral", "overworld"],
    sourceFilename: "Allay.png",
    defaultDisplaySize: 120,
  },
  // Hostiles
  {
    canonical: "Blaze",
    categories: ["entity", "hostile", "nether"],
    sourceFilename: "Blaze.png",
    defaultDisplaySize: 140,
  },
  {
    canonical: "Wither_Skeleton",
    categories: ["entity", "hostile", "nether"],
    sourceFilename: "Wither_Skeleton.png",
    defaultDisplaySize: 140,
  },
  {
    canonical: "Skeleton",
    categories: ["entity", "hostile", "overworld"],
    sourceFilename: "Skeleton.png",
    defaultDisplaySize: 140,
  },
  {
    canonical: "Zombie",
    categories: ["entity", "hostile", "overworld"],
    sourceFilename: "Zombie.png",
    defaultDisplaySize: 140,
  },
  {
    canonical: "Creeper",
    categories: ["entity", "hostile", "overworld"],
    sourceFilename: "Creeper.png",
    defaultDisplaySize: 140,
  },
];

interface ResolvedItem {
  canonical: string;
  category: CatalogCategory;
  sourceFilename: string;
  bytes: Uint8Array;
}

interface SkippedItem {
  canonical: string;
  reason: string;
}

interface ResolvedBlock {
  seed: BlockSeed;
  sourceFilename: string;
  bytes: Uint8Array;
}

interface ResolvedEntity {
  seed: EntitySeed;
  /** Actual wiki filename used (may differ from seed.sourceFilename). */
  resolvedFilename: string;
  isAnimated: boolean;
  bytes: Uint8Array;
  pngBytes: Uint8Array;
  sourceWidthPx: number;
  sourceHeightPx: number;
}

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
          reason: `image fetch error: ${(err as Error).message}`,
        },
      };
    }
  }

  try {
    const html = await fetchArticleHtml(canonical);
    if (!html) {
      return {
        skipped: { canonical, reason: "article 404 and no direct icon" },
      };
    }
    const scraped = pickArticleIcon(html, canonical);
    if (!scraped) {
      return {
        skipped: { canonical, reason: "article had no Invicon image" },
      };
    }
    const bytes = await fetchImageBytes(scraped);
    if (!bytes) {
      return {
        skipped: { canonical, reason: `scraped icon 404: ${scraped}` },
      };
    }
    return { canonical, category, sourceFilename: scraped, bytes };
  } catch (err) {
    return {
      skipped: {
        canonical,
        reason: `article fetch error: ${(err as Error).message}`,
      },
    };
  }
}

async function resolveBlock(
  seed: BlockSeed,
): Promise<ResolvedBlock | { skipped: SkippedItem }> {
  if (seed.sourceFilenameOverride) {
    try {
      const bytes = await fetchImageBytes(seed.sourceFilenameOverride);
      if (bytes) {
        return { seed, sourceFilename: seed.sourceFilenameOverride, bytes };
      }
      return {
        skipped: {
          canonical: seed.canonical,
          reason: `override 404: ${seed.sourceFilenameOverride}`,
        },
      };
    } catch (err) {
      return {
        skipped: {
          canonical: seed.canonical,
          reason: `override fetch error: ${(err as Error).message}`,
        },
      };
    }
  }

  const result = await resolveItem(seed.canonical, "block");
  if ("skipped" in result) return result;
  return {
    seed,
    sourceFilename: result.sourceFilename,
    bytes: result.bytes,
  };
}

async function decodeAnimatedFrameZero(bytes: Uint8Array): Promise<{
  pngBytes: Uint8Array;
  width: number;
  height: number;
}> {
  // Copy into a fresh ArrayBuffer so we don't drag along SharedArrayBuffer
  // typing from views over a Buffer-backed pool.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const gif = parseGIF(ab);
  const frames = decompressFrames(gif, true);
  if (frames.length === 0) {
    throw new Error("GIF had zero decodable frames");
  }
  const frame = frames[0];
  const width = frame.dims.width;
  const height = frame.dims.height;
  const rawRgba = Buffer.from(frame.patch);
  const png = await sharp(rawRgba, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
  return { pngBytes: new Uint8Array(png), width, height };
}

async function resampleToDisplaySize(
  pngBytes: Uint8Array,
  size: number,
): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(pngBytes))
    .resize(size, size, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  return new Uint8Array(out);
}

const ENTITY_FALLBACK_SUFFIXES = [
  "_JE3_BE3",
  "_JE3_BE2",
  "_JE2_BE2",
  "_JE2_BE1",
  "_JE1_BE1",
  "_JE5_BE3",
  "_JE6_BE3",
  "_JE1",
];

async function resolveEntityBytes(
  seed: EntitySeed,
): Promise<{ filename: string; bytes: Uint8Array } | null> {
  // Try the explicit hint first.
  const tried = new Set<string>();
  const tryName = async (name: string) => {
    if (tried.has(name)) return null;
    tried.add(name);
    return await fetchImageBytes(name);
  };

  let bytes = await tryName(seed.sourceFilename);
  if (bytes) return { filename: seed.sourceFilename, bytes };

  // Try suffix variations on the canonical name (PNG and GIF).
  for (const suffix of ENTITY_FALLBACK_SUFFIXES) {
    for (const ext of [".png", ".gif"]) {
      const name = `${seed.canonical}${suffix}${ext}`;
      bytes = await tryName(name);
      if (bytes) return { filename: name, bytes };
    }
  }

  // Article scrape — find any /<canonical>_(JE|BE).../.png|gif/ image.
  const html = await fetchArticleHtml(seed.canonical);
  if (html) {
    const re = new RegExp(
      `\\/images\\/(?:thumb\\/[^\\/]+\\/[^\\/]+\\/)?(${seed.canonical}(?:_(?:JE|BE)[0-9_A-Z]+)?\\.(?:png|gif))`,
      "g",
    );
    const found = Array.from(html.matchAll(re), (m) => m[1]);
    const sorted = uniq(found).sort((a, b) => a.length - b.length);
    for (const name of sorted) {
      bytes = await tryName(name);
      if (bytes) return { filename: name, bytes };
    }
  }
  return null;
}

async function resolveEntity(
  seed: EntitySeed,
): Promise<ResolvedEntity | { skipped: SkippedItem }> {
  try {
    const fetched = await resolveEntityBytes(seed);
    if (!fetched) {
      return {
        skipped: {
          canonical: seed.canonical,
          reason: `entity 404 across hints: ${seed.sourceFilename}`,
        },
      };
    }
    const bytes = fetched.bytes;
    const resolvedFilename = fetched.filename;

    const isAnimated = resolvedFilename.toLowerCase().endsWith(".gif");
    let pngBytes: Uint8Array;
    let sourceWidthPx: number;
    let sourceHeightPx: number;

    if (isAnimated) {
      const decoded = await decodeAnimatedFrameZero(bytes);
      pngBytes = decoded.pngBytes;
      sourceWidthPx = decoded.width;
      sourceHeightPx = decoded.height;
    } else {
      const meta = await sharp(Buffer.from(bytes)).metadata();
      sourceWidthPx = meta.width ?? 0;
      sourceHeightPx = meta.height ?? 0;
      // Re-encode through sharp so the file is normalized to PNG and stripped.
      pngBytes = new Uint8Array(
        await sharp(Buffer.from(bytes)).png().toBuffer(),
      );
    }

    const displaySize = seed.defaultDisplaySize ?? 200;
    const resampled = await resampleToDisplaySize(pngBytes, displaySize);
    return {
      seed,
      resolvedFilename,
      isAnimated,
      bytes,
      pngBytes: resampled,
      sourceWidthPx,
      sourceHeightPx,
    };
  } catch (err) {
    return {
      skipped: {
        canonical: seed.canonical,
        reason: `entity error: ${(err as Error).message}`,
      },
    };
  }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function computeDifficultyFlags(
  bytes: Uint8Array,
  canonical: string,
): CatalogItemAsset["flags"] {
  try {
    const imageData = asImageData(decodePngToImageData(bytes));
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
      `  [difficulty] could not compute for ${canonical}: ${(err as Error).message}`,
    );
    return undefined;
  }
}

function humanize(canonical: string): string {
  return canonical.replace(/_\(.+\)$/, "").replaceAll("_", " ").trim();
}

function thumbnailFilename(canonical: string): string {
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
  const runners = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    () => next(),
  );
  await Promise.all(runners);
  return results;
}

function applyPluralOpts<T extends PluralOpts>(target: PluralOpts, src: T) {
  if (src.displayNameSingular !== undefined)
    target.displayNameSingular = src.displayNameSingular;
  if (src.displayNamePlural !== undefined)
    target.displayNamePlural = src.displayNamePlural;
  if (src.massNoun !== undefined) target.massNoun = src.massNoun;
  if (src.pluralOverride !== undefined)
    target.pluralOverride = src.pluralOverride;
}

async function main() {
  console.log("Davis Puzzle catalog builder (v2)");
  console.log("==================================");

  await ensureDir(CACHE_DIR);
  await ensureDir(ITEMS_DIR);
  await ensureDir(BLOCKS_DIR);
  await ensureDir(ENTITIES_DIR);

  // ---- Items pipeline (Pixel Puzzle) ----
  const itemWork: { canonical: string; category: CatalogCategory }[] = [];
  for (const [category, list] of Object.entries(ITEM_SEEDS) as [
    CatalogCategory,
    string[],
  ][]) {
    for (const canonical of list) {
      itemWork.push({ canonical, category });
    }
  }
  console.log(
    `Item seeds: ${itemWork.length} across ${
      Object.keys(ITEM_SEEDS).filter((k) => ITEM_SEEDS[k as CatalogCategory].length > 0).length
    } categories.`,
  );

  const itemResults = await runWithConcurrency(
    itemWork,
    (job) => resolveItem(job.canonical, job.category),
    MAX_CONCURRENCY,
  );

  const resolvedItems: ResolvedItem[] = [];
  const skippedAll: SkippedItem[] = [];
  for (const r of itemResults) {
    if ("skipped" in r) skippedAll.push(r.skipped);
    else resolvedItems.push(r);
  }

  for (const item of resolvedItems) {
    const filename = thumbnailFilename(item.canonical) + ".png";
    await writeFile(path.join(ITEMS_DIR, filename), item.bytes);
  }

  const items: CatalogItemAsset[] = resolvedItems.map((r) => ({
    kind: "item",
    canonicalName: r.canonical,
    displayName: humanize(r.canonical),
    sourceFilename: r.sourceFilename,
    categories: [r.category],
    thumbnailPath: `/items/${thumbnailFilename(r.canonical)}.png`,
    displayPixelSize: 16,
    flags: computeDifficultyFlags(r.bytes, r.canonical),
  }));

  // Stable order: by category-as-seeded, then by canonicalName.
  const itemCategoryOrder: Record<string, number> = {};
  let oi = 0;
  for (const cat of Object.keys(ITEM_SEEDS) as CatalogCategory[]) {
    itemCategoryOrder[cat] = oi++;
  }
  items.sort((a, b) => {
    const ca = a.categories[0];
    const cb = b.categories[0];
    return (
      (itemCategoryOrder[ca] ?? 99) - (itemCategoryOrder[cb] ?? 99) ||
      a.canonicalName.localeCompare(b.canonicalName)
    );
  });

  // ---- Blocks pipeline ----
  console.log(`Block seeds: ${BLOCK_SEEDS.length}.`);
  const blockResults = await runWithConcurrency(
    BLOCK_SEEDS,
    (seed) => resolveBlock(seed),
    MAX_CONCURRENCY,
  );

  const resolvedBlocks: ResolvedBlock[] = [];
  for (const r of blockResults) {
    if ("skipped" in r) skippedAll.push(r.skipped);
    else resolvedBlocks.push(r);
  }
  for (const b of resolvedBlocks) {
    const filename = thumbnailFilename(b.seed.canonical) + ".png";
    // Non-Invicon block art (Sculk, Prismarine, Sea Lantern) ships at native
    // resolution; resample to 16×16 with nearest-neighbor to match Pixel
    // Puzzle's inventory icons. Animated GIFs decode frame 0 first.
    const isInvicon = b.sourceFilename.startsWith("Invicon_");
    const isGif = b.sourceFilename.toLowerCase().endsWith(".gif");
    let outBytes: Uint8Array;
    if (isInvicon && !isGif) {
      outBytes = b.bytes;
    } else {
      let pngSource: Uint8Array;
      if (isGif) {
        const decoded = await decodeAnimatedFrameZero(b.bytes);
        pngSource = decoded.pngBytes;
      } else {
        pngSource = b.bytes;
      }
      const resampled = await sharp(Buffer.from(pngSource))
        .resize(16, 16, {
          fit: "fill",
          kernel: sharp.kernel.nearest,
        })
        .png()
        .toBuffer();
      outBytes = new Uint8Array(resampled);
    }
    await writeFile(path.join(BLOCKS_DIR, filename), outBytes);
  }

  const blocks: CatalogBlockAsset[] = resolvedBlocks.map((r) => {
    const asset: CatalogBlockAsset = {
      kind: "block",
      canonicalName: r.seed.canonical,
      displayName: r.seed.displayNameOverride ?? humanize(r.seed.canonical),
      sourceFilename: r.sourceFilename,
      categories: r.seed.categories,
      thumbnailPath: `/blocks/${thumbnailFilename(r.seed.canonical)}.png`,
      displayPixelSize: 16,
      isPlaceableInAssembly: r.seed.isPlaceableInAssembly ?? false,
    };
    applyPluralOpts(asset, r.seed);
    return asset;
  });
  blocks.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));

  // ---- Entities pipeline ----
  console.log(`Entity seeds: ${ENTITY_SEEDS.length}.`);
  const entityResults = await runWithConcurrency(
    ENTITY_SEEDS,
    (seed) => resolveEntity(seed),
    MAX_CONCURRENCY,
  );

  const resolvedEntities: ResolvedEntity[] = [];
  for (const r of entityResults) {
    if ("skipped" in r) skippedAll.push(r.skipped);
    else resolvedEntities.push(r);
  }
  for (const e of resolvedEntities) {
    const filename = thumbnailFilename(e.seed.canonical) + ".png";
    await writeFile(path.join(ENTITIES_DIR, filename), e.pngBytes);
  }

  const entities: CatalogEntityAsset[] = resolvedEntities.map((r) => {
    const asset: CatalogEntityAsset = {
      kind: "entity",
      canonicalName: r.seed.canonical,
      displayName: r.seed.displayNameOverride ?? humanize(r.seed.canonical),
      sourceFilename: r.resolvedFilename,
      categories: r.seed.categories,
      thumbnailPath: `/entities/${thumbnailFilename(r.seed.canonical)}.png`,
      defaultDisplaySize: r.seed.defaultDisplaySize ?? 200,
      sourceIsAnimated: r.isAnimated,
      sourceWidthPx: r.sourceWidthPx,
      sourceHeightPx: r.sourceHeightPx,
    };
    applyPluralOpts(asset, r.seed);
    return asset;
  });
  entities.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));

  const catalog: CatalogFile = {
    _schema: CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    assetCount: items.length + blocks.length + entities.length,
    items,
    blocks,
    entities,
  };

  if (!isCatalogFile(catalog)) {
    throw new Error("internal: produced catalog does not pass isCatalogFile()");
  }

  // Confirm every thumbnail exists on disk.
  const allAssets: CatalogAsset[] = [
    ...catalog.items,
    ...catalog.blocks,
    ...catalog.entities,
  ];
  for (const asset of allAssets) {
    const onDisk = path.join(
      PUBLIC_DIR,
      asset.thumbnailPath.replace(/^\//, ""),
    );
    const st = await stat(onDisk).catch(() => null);
    if (!st || !st.isFile()) {
      throw new Error(`thumbnail missing on disk: ${onDisk}`);
    }
  }

  await writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  // Summary.
  console.log("");
  console.log("=== Summary ===");
  console.log(`Items resolved:    ${items.length}`);
  console.log(`Blocks resolved:   ${blocks.length}`);
  console.log(`Entities resolved: ${entities.length}`);
  console.log(`Total assets:      ${catalog.assetCount}`);
  console.log(`Skipped:           ${skippedAll.length}`);

  const perDifficulty = new Map<string, number>();
  for (const item of catalog.items) {
    const d = item.flags?.difficulty;
    if (typeof d === "string") {
      perDifficulty.set(d, (perDifficulty.get(d) ?? 0) + 1);
    }
  }
  console.log("Item difficulty distribution:");
  for (const bucket of ["easy", "medium", "hard"]) {
    console.log(`  ${bucket.padEnd(10)} ${perDifficulty.get(bucket) ?? 0}`);
  }

  if (skippedAll.length > 0) {
    console.log("");
    console.log("Skipped:");
    for (const s of skippedAll) {
      console.log(`  - ${s.canonical}: ${s.reason}`);
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
