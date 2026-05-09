// Generate /public/themes/*.png cards for the Maze Hunt activity selector.
//
// Each thumbnail is a 256×256 PNG composited from the theme's accent color +
// boss portrait + collectible icon. Run alongside `pnpm catalog:build`.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const REPO_ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const THEMES_DIR = path.join(PUBLIC_DIR, "themes");

interface ThemeSpec {
  id: string;
  /** Hex color for the card background. */
  backgroundColor: string;
  /** path under public/ */
  bossPath: string;
  /** path under public/ for the collectible icon (block) */
  collectiblePath: string;
}

const SPECS: ThemeSpec[] = [
  {
    id: "end-island",
    backgroundColor: "#3b1e54",
    bossPath: "entities/ender_dragon.png",
    collectiblePath: "blocks/end_crystal.png",
  },
  {
    id: "nether",
    backgroundColor: "#5e1010",
    bossPath: "entities/wither.png",
    collectiblePath: "blocks/wither_skeleton_skull.png",
  },
  {
    id: "ocean-monument",
    backgroundColor: "#143a5f",
    bossPath: "entities/elder_guardian.png",
    collectiblePath: "blocks/wet_sponge.png",
  },
];

async function main() {
  await mkdir(THEMES_DIR, { recursive: true });
  for (const spec of SPECS) {
    const bossBytes = await readFile(path.join(PUBLIC_DIR, spec.bossPath));
    const collectibleBytes = await readFile(
      path.join(PUBLIC_DIR, spec.collectiblePath),
    );

    const boss = await sharp(bossBytes)
      .resize(170, 170, { fit: "inside", kernel: sharp.kernel.nearest })
      .png()
      .toBuffer();
    const collectible = await sharp(collectibleBytes)
      .resize(72, 72, { fit: "inside", kernel: sharp.kernel.nearest })
      .png()
      .toBuffer();

    const bgRgba = hexToRgba(spec.backgroundColor);
    const bg = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: bgRgba,
      },
    })
      .composite([
        { input: boss, gravity: "center" },
        { input: collectible, top: 168, left: 16 },
      ])
      .png()
      .toBuffer();

    const outPath = path.join(THEMES_DIR, `${spec.id}.png`);
    await writeFile(outPath, bg);
    console.log(`wrote ${outPath}`);
  }
}

function hexToRgba(hex: string): { r: number; g: number; b: number; alpha: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`bad hex: ${hex}`);
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
    alpha: 1,
  };
}

main().catch((err) => {
  console.error("theme-thumbnail build failed:", err);
  process.exit(1);
});
