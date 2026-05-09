/**
 * Calibration runner for lib/difficulty.ts.
 *
 * Iterates CALIBRATION_SET, fetches each item's PNG (preferring the cached
 * .cache/wiki/ artifacts dropped by scripts/build-catalog.ts; falls back to
 * minecraft.wiki direct), runs the palette extractor at maxColors=8, and
 * asserts the computed bucket matches the expected label.
 *
 * Run with: pnpm difficulty:test
 *
 * Exits non-zero on any miss. Always prints a per-item summary so a partial
 * regression is easy to read in CI logs.
 */

import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractPaletteFromImageData } from "@/lib/palette";
import { computeDifficulty } from "@/lib/difficulty";
import { CALIBRATION_SET } from "@/lib/difficulty.fixture";
import { asImageData, decodePngToImageData } from "@/lib/nodeImageData";

const USER_AGENT = "DavisPuzzleWeb/1.0 (OT therapy worksheets)";
const REPO_ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(REPO_ROOT, ".cache", "wiki");
const MAX_COLORS = 8;

function cachePathForFilename(filename: string): string {
  return path.join(CACHE_DIR, `image_${filename}`);
}

async function fetchPngBytes(canonicalName: string): Promise<Uint8Array> {
  // Try the same direct filename probes used by lib/fetchTexture.ts +
  // scripts/build-catalog.ts so the test reuses the cache when available.
  const stripped = canonicalName.replace(/_\(.+\)$/, "");
  const candidates = Array.from(
    new Set([
      `Invicon_${canonicalName}.png`,
      `Invicon_${stripped}.png`,
      `Invicon_Raw_${canonicalName}.png`,
      `Invicon_Cooked_${canonicalName}.png`,
    ]),
  );

  // Cache hits first.
  for (const filename of candidates) {
    const p = cachePathForFilename(filename);
    if (existsSync(p)) {
      const buf = await readFile(p);
      return new Uint8Array(buf);
    }
  }

  // Cache miss: politely hit minecraft.wiki and write through the cache so
  // subsequent runs are offline.
  await mkdir(CACHE_DIR, { recursive: true });
  for (const filename of candidates) {
    const url = `https://minecraft.wiki/images/${encodeURIComponent(filename)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store" as RequestCache,
    });
    if (res.status === 404) continue;
    if (!res.ok) {
      throw new Error(`fetch ${filename} -> http ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeFile(cachePathForFilename(filename), bytes);
    return bytes;
  }
  throw new Error(
    `no Invicon match for canonicalName=${canonicalName} (tried: ${candidates.join(", ")})`,
  );
}

interface RunResult {
  canonical: string;
  expected: string;
  actual: string;
  ok: boolean;
  score: number;
  paletteSize: number;
  effective: number;
  fragments: number;
  fragPerColor: string;
  minDist: string;
  meanDist: string;
  cells: number;
  dominant: string;
  isolated: number;
  edge: string;
  entropy: string;
  compactness: string;
  explanation: string;
}

async function runOne(
  canonical: string,
  expected: string,
): Promise<RunResult> {
  const bytes = await fetchPngBytes(canonical);
  const imageData = asImageData(decodePngToImageData(bytes));
  const { palette } = extractPaletteFromImageData(imageData, MAX_COLORS);
  const result = computeDifficulty(palette);
  const actual = result.bucket;

  return {
    canonical,
    expected,
    actual,
    ok: actual === expected,
    score: result.score,
    paletteSize: result.signals.paletteSize,
    effective: result.signals.effectivePaletteSize,
    fragments: result.signals.fragmentCount,
    fragPerColor: result.signals.fragmentsPerColor.toFixed(2),
    minDist: result.signals.minColorDistance.toFixed(0),
    meanDist: result.signals.meanColorDistance.toFixed(0),
    cells: result.signals.opaqueCellCount,
    dominant: result.signals.dominantShare.toFixed(2),
    isolated: result.signals.isolatedCellCount,
    edge: result.signals.edgeDensity.toFixed(2),
    entropy: result.signals.paletteEntropy.toFixed(2),
    compactness: result.signals.meanCompactness.toFixed(2),
    explanation: result.explanation,
  };
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

async function main() {
  console.log("Difficulty calibration test");
  console.log("===========================");
  console.log(
    pad("item", 22) +
      pad("expected", 10) +
      pad("actual", 10) +
      pad("score", 7) +
      pad("pal", 5) +
      pad("eff", 5) +
      pad("frag", 6) +
      pad("minD", 6) +
      pad("meanD", 7) +
      pad("cells", 7) +
      pad("ent", 6),
  );

  const results: RunResult[] = [];
  for (const c of CALIBRATION_SET) {
    try {
      const r = await runOne(c.canonicalName, c.expected);
      results.push(r);
      console.log(
        (r.ok ? "PASS " : "FAIL ") +
          pad(r.canonical, 17) +
          pad(r.expected, 10) +
          pad(r.actual, 10) +
          pad(r.score, 7) +
          pad(r.paletteSize, 5) +
          pad(r.effective, 5) +
          pad(r.fragments, 6) +
          pad(r.minDist, 6) +
          pad(r.meanDist, 7) +
          pad(r.cells, 7) +
          pad(r.entropy, 6),
      );
    } catch (err) {
      console.log(
        "ERROR " +
          pad(c.canonicalName, 16) +
          pad(c.expected, 10) +
          "(threw): " +
          (err as Error).message,
      );
      results.push({
        canonical: c.canonicalName,
        expected: c.expected,
        actual: "error",
        ok: false,
        score: 0,
        paletteSize: 0,
        effective: 0,
        fragments: 0,
        fragPerColor: "-",
        minDist: "-",
        meanDist: "-",
        cells: 0,
        dominant: "-",
        isolated: 0,
        edge: "-",
        entropy: "-",
        compactness: "-",
        explanation: (err as Error).message,
      });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log("");
  console.log(`Passed: ${passed} / ${results.length}`);
  if (failed > 0) {
    console.log("Failures:");
    for (const r of results.filter((r) => !r.ok)) {
      console.log(
        `  ${r.canonical}: expected=${r.expected} actual=${r.actual} score=${r.score}`,
      );
      console.log(`    -> ${r.explanation}`);
    }
    process.exit(1);
  }

  // Optional debug: show the explanation strings on success too — useful when
  // tweaking copy.
  console.log("");
  console.log("Explanations:");
  for (const r of results) {
    console.log(`  ${r.canonical} (${r.actual}): ${r.explanation}`);
  }
}

main().catch((err) => {
  console.error("Calibration test crashed:", err);
  process.exit(1);
});
