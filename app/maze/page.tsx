"use client";

// Epic 1+2 scratch page. Drives the full Maze Hunt pipeline (maze + collectibles
// + assembly + cutouts) end-to-end against the 3 v1 themes. The polished UI
// lands behind the tab strip in app/page.tsx in Epic 4.

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  generateMaze,
  type CardinalPosition,
  type CellCountPreset,
  type MazeCell,
  type MazeGrid,
  type Silhouette,
} from "@/lib/maze";
import { placeCollectibles } from "@/lib/placement";
import { assemblyIdFromKey, getAssembly } from "@/lib/assemblies";
import {
  loadMazeHuntThemes,
  type DifficultyPreset,
  type MazeHuntTheme,
} from "@/lib/mazeHuntThemes";
import { isPuzzleError } from "@/lib/errors";

interface GeneratedPdf {
  id: string;
  url: string;
  filename: string;
  themeLabel: string;
  difficulty: DifficultyPreset;
  seed: string;
  cells: { across: number; down: number };
  walls: number;
  collectibleCount: number;
  hasAssembly: boolean;
}

function silhouetteForTheme(
  theme: MazeHuntTheme,
  preset: DifficultyPreset,
): { silhouette: Silhouette; preset: CellCountPreset } {
  const presetMap: Record<DifficultyPreset, CellCountPreset> = {
    easy: "small",
    medium: "medium",
    hard: "large",
  };
  const cellPreset = presetMap[preset];
  if (theme.silhouette === "rectangle") {
    const dims =
      cellPreset === "small"
        ? { width: 12, height: 16 }
        : cellPreset === "medium"
          ? { width: 16, height: 20 }
          : { width: 22, height: 27 };
    return {
      silhouette: { kind: "rectangle", width: dims.width, height: dims.height },
      preset: cellPreset,
    };
  }
  if (theme.silhouette === "circle") {
    const d = cellPreset === "small" ? 14 : cellPreset === "medium" ? 18 : 22;
    return { silhouette: { kind: "circle", diameter: d }, preset: cellPreset };
  }
  // diamond-star → maze generator's star4
  const d = cellPreset === "small" ? 14 : cellPreset === "medium" ? 18 : 22;
  return { silhouette: { kind: "star4", boundingBox: d }, preset: cellPreset };
}

function defaultEntranceFor(theme: MazeHuntTheme): CardinalPosition {
  if (theme.silhouette === "diamond-star") return "N";
  return "S";
}

function defaultExitFor(theme: MazeHuntTheme): CardinalPosition {
  if (theme.silhouette === "diamond-star") return "S";
  return "N";
}

function findInShapeCenter(grid: MazeGrid): MazeCell | null {
  const cx = Math.floor(grid.cellsAcross / 2);
  const cy = Math.floor(grid.cellsDown / 2);
  // Spiral outwards looking for an in-shape cell near geometric center.
  for (let r = 0; r < Math.max(grid.cellsAcross, grid.cellsDown); r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (
          y >= 0 &&
          y < grid.cellsDown &&
          x >= 0 &&
          x < grid.cellsAcross &&
          grid.inShape[y]?.[x] === true
        ) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

async function fetchSpriteBytes(
  paths: Record<string, string>,
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      const res = await fetch(path);
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      out[key] = new Uint8Array(buf);
    }),
  );
  return out;
}

export default function MazeScratchPage() {
  const [themes, setThemes] = useState<MazeHuntTheme[]>([]);
  const [activeThemeId, setActiveThemeId] = useState<string>("end-island");
  const [difficulty, setDifficulty] = useState<DifficultyPreset>("medium");
  const [showSolution, setShowSolution] = useState(false);
  const [bwSafe, setBwSafe] = useState(false);
  const [showAnswerKey, setShowAnswerKey] = useState(false);
  const [pdf, setPdf] = useState<GeneratedPdf | null>(null);
  const [status, setStatus] = useState(
    "Pick a theme and a difficulty, then Generate.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const generateButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMazeHuntThemes()
      .then((data) => {
        if (cancelled) return;
        setThemes(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load themes.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdf) URL.revokeObjectURL(pdf.url);
    };
  }, [pdf]);

  const activeTheme = useMemo(
    () => themes.find((t) => t.id === activeThemeId) ?? null,
    [themes, activeThemeId],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!activeTheme) {
      setError("No theme loaded yet.");
      return;
    }
    setIsGenerating(true);
    let nextUrl: string | null = null;
    let committed = false;
    try {
      setStatus("Generating maze...");
      const { silhouette, preset } = silhouetteForTheme(
        activeTheme,
        difficulty,
      );
      const grid = generateMaze({
        silhouette,
        cellCountPreset: preset,
        entrance: defaultEntranceFor(activeTheme),
        exit: defaultExitFor(activeTheme),
      });

      setStatus("Placing collectibles...");
      const diff = activeTheme.difficulties[difficulty];
      const population = activeTheme.collectibles.map((c) => ({
        itemRef: c.canonicalName,
        count: Math.max(
          1,
          Math.floor(diff.collectibleCount / activeTheme.collectibles.length),
        ),
      }));
      const placement = placeCollectibles({
        maze: grid,
        population,
        mode: diff.collectiblesAllOnPath ? "all-on-path" : "mixed",
        seed: grid.seed + "P",
      });
      if (!placement.ok) {
        throw new Error(`Placement failed: ${placement.reason}`);
      }

      // Boss center cell
      const bossCell = findInShapeCenter(grid);
      const boss =
        bossCell !== null
          ? { cell: bossCell, itemRef: activeTheme.boss.canonicalName }
          : undefined;

      setStatus("Loading assembly + sprites...");
      const assemblyId = assemblyIdFromKey(activeTheme.assembly.key);
      const assembly =
        assemblyId !== null ? getAssembly(assemblyId) : undefined;

      // Build sprite path map.
      const spritePaths: Record<string, string> = {};
      for (const c of activeTheme.collectibles) {
        spritePaths[c.canonicalName] = canonicalPath(c.canonicalName);
      }
      spritePaths[activeTheme.boss.canonicalName] = canonicalPath(
        activeTheme.boss.canonicalName,
      );
      if (assembly) {
        for (const row of assembly.gridShape) {
          for (const slot of row) {
            if (slot.kind === "paste") {
              spritePaths[slot.defaultItem] = canonicalPath(slot.defaultItem);
              spritePaths[slot.answerItem] = canonicalPath(slot.answerItem);
            } else if (slot.kind === "decorative") {
              spritePaths[slot.item] = canonicalPath(slot.item);
            }
          }
        }
        for (const cutout of assembly.cutoutPanel) {
          spritePaths[cutout.item] = canonicalPath(cutout.item);
        }
      }
      const spriteBytes = await fetchSpriteBytes(spritePaths);

      setStatus("Rendering PDF...");
      const { buildMazeHuntPdf } = await import("@/lib/pdf/mazeHunt");
      const themeLabel = activeTheme.displayName;
      const pdfBytes = await buildMazeHuntPdf({
        grid,
        title: themeLabel,
        themeLabel,
        showSolutionPath: showSolution,
        blackAndWhiteSafe: bwSafe,
        collectibles: placement.placements,
        boss,
        assembly,
        cutoutSize:
          diff.cutoutSize === "small"
            ? "small"
            : diff.cutoutSize === "large"
              ? "large"
              : "medium",
        showAssemblyAnswerKey: showAnswerKey,
        spriteBytes,
      });
      const buffer = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(buffer).set(pdfBytes);
      const blob = new Blob([buffer], { type: "application/pdf" });
      nextUrl = URL.createObjectURL(blob);
      const filename = `${activeTheme.id}_${difficulty}_${grid.seed}.pdf`;
      setPdf({
        id: `${grid.seed}-${Date.now()}`,
        url: nextUrl,
        filename,
        themeLabel,
        difficulty,
        seed: grid.seed,
        cells: { across: grid.cellsAcross, down: grid.cellsDown },
        walls: grid.walls.length,
        collectibleCount: placement.totalCount,
        hasAssembly: assembly !== undefined,
      });
      committed = true;
      setStatus(
        `Preview ready — ${placement.totalCount} collectibles placed, ${grid.walls.length} walls. Confirm to download.`,
      );
    } catch (err) {
      if (isPuzzleError(err)) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong rendering the worksheet.");
      }
      setStatus("Could not generate the worksheet.");
    } finally {
      if (!committed && nextUrl) URL.revokeObjectURL(nextUrl);
      setIsGenerating(false);
    }
  }

  function triggerDownload(): void {
    if (!pdf) return;
    const a = document.createElement("a");
    a.href = pdf.url;
    a.download = pdf.filename;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--foreground)] sm:px-8">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
            Maze Hunt — Epic 2 scratch
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-[var(--heading)]">
            Themed maze worksheet (collectibles + assembly)
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Drives the full v1 pipeline: maze generation + collectible
            placement + assembly target + cutout strip. The polished front-door
            UI lands in Epic 4.
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm"
        >
          <div className="space-y-5">
            <div>
              <label
                htmlFor="theme"
                className="block text-sm font-medium text-[var(--heading)]"
              >
                Theme
              </label>
              <select
                id="theme"
                value={activeThemeId}
                onChange={(e) => setActiveThemeId(e.target.value)}
                disabled={isGenerating || themes.length === 0}
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base"
              >
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="difficulty"
                className="block text-sm font-medium text-[var(--heading)]"
              >
                Difficulty
              </label>
              <select
                id="difficulty"
                value={difficulty}
                onChange={(e) =>
                  setDifficulty(e.target.value as DifficultyPreset)
                }
                disabled={isGenerating}
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showSolution}
                  onChange={(e) => setShowSolution(e.target.checked)}
                  disabled={isGenerating}
                />
                <span>Show maze answer-key path</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bwSafe}
                  onChange={(e) => setBwSafe(e.target.checked)}
                  disabled={isGenerating}
                />
                <span>Black-and-white safe path</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showAnswerKey}
                  onChange={(e) => setShowAnswerKey(e.target.checked)}
                  disabled={isGenerating}
                />
                <span>Show assembly answer key</span>
              </label>
            </div>
            <button
              ref={generateButtonRef}
              type="submit"
              disabled={isGenerating || themes.length === 0}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isGenerating ? (
                <>
                  <span className="davis-spinner" aria-hidden="true" />
                  <span>Generating…</span>
                </>
              ) : (
                "Generate"
              )}
            </button>
          </div>
          <div
            aria-live="polite"
            className="mt-4 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-sm leading-6"
          >
            <p className="font-medium text-[var(--heading)]">{status}</p>
            {error ? (
              <p className="mt-2 text-[var(--error)]">{error}</p>
            ) : null}
          </div>
        </form>
        {pdf ? (
          <section className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--heading)]">
              Preview ready
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-[var(--foreground)]">
              <dt className="font-medium">Theme</dt>
              <dd>{pdf.themeLabel}</dd>
              <dt className="font-medium">Difficulty</dt>
              <dd>{pdf.difficulty}</dd>
              <dt className="font-medium">Cells</dt>
              <dd>
                {pdf.cells.across} × {pdf.cells.down}
              </dd>
              <dt className="font-medium">Walls</dt>
              <dd>{pdf.walls}</dd>
              <dt className="font-medium">Collectibles</dt>
              <dd>{pdf.collectibleCount}</dd>
              <dt className="font-medium">Assembly</dt>
              <dd>{pdf.hasAssembly ? "yes" : "no"}</dd>
              <dt className="font-medium">Seed</dt>
              <dd className="font-mono">{pdf.seed}</dd>
            </dl>
            <button
              type="button"
              onClick={triggerDownload}
              className="mt-5 cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
            >
              Confirm download
            </button>
          </section>
        ) : null}
      </section>
    </main>
  );
}

/**
 * Resolve the static thumbnail path for a canonicalName by trying each known
 * directory. We don't have direct access to the catalog at component-mount
 * time, so we encode the slug rule (lowercase, strip parens) and rely on the
 * server to 404 when the asset is in a different directory.
 *
 * Maze Hunt v1 always uses entities for bosses (entities/), blocks for
 * collectibles (blocks/), and items only for Pixel Puzzle. We pick the
 * directory based on the canonicalName via a small heuristic plus the
 * convention that block / entity canonicalNames are pre-baked in our seed
 * lists. For simplicity, return all 3 candidates space-separated; the caller
 * fetches the first that responds 200. (We just return the most likely one.)
 *
 * Cleaner alternative: load /items.json and resolve from there. v1 keeps it
 * simple by encoding the convention.
 */
function canonicalPath(canonicalName: string): string {
  const slug = canonicalName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/'/g, "");
  // Convention: bosses/entities live under /entities/, blocks under /blocks/,
  // items under /items/. v1 themes only reference entities and blocks.
  return resolveCanonicalDir(canonicalName, slug);
}

const ENTITY_NAMES = new Set([
  "Ender_Dragon",
  "Wither",
  "Elder_Guardian",
  "Warden",
  "Iron_Golem",
  "Snow_Golem",
  "Allay",
  "Blaze",
  "Wither_Skeleton",
  "Skeleton",
  "Zombie",
  "Creeper",
]);

function resolveCanonicalDir(canonical: string, slug: string): string {
  if (ENTITY_NAMES.has(canonical)) return `/entities/${slug}.png`;
  // Blocks are guaranteed to ship as 16x16 PNGs under /blocks/ for everything
  // we ship in maze-hunt-themes.json. The Pixel Puzzle items go under /items/.
  return `/blocks/${slug}.png`;
}
