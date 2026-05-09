"use client";

// Maze Hunt panel — drives the full pipeline (maze + collectibles + assembly
// + cutouts + objectives + two-up print) end-to-end. Embedded inside the
// activity tab strip on `/`. Receives an initialThemeId / initialDifficulty
// from the activity selector when Andrew picks a card. Exits back to the
// selector via the "Back to themes" button.

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
import {
  buildCatalogLookup,
  composeObjectives,
  type CatalogLookup,
  type Objective,
  type ObjectiveSlot,
} from "@/lib/objectives";
import { isCatalogFile, type CatalogFile } from "@/lib/catalog";

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
  objectives: Objective[];
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

const SLOT_LABELS: Record<ObjectiveSlot, string> = {
  navigate: "Navigate",
  find: "Find",
  escape: "Escape",
  craft: "Craft",
  "state-change": "State change",
};

export interface MazeHuntPanelProps {
  initialThemeId?: string;
  initialDifficulty?: DifficultyPreset;
  /** Optional callback — invoked when Andrew clicks "Back to themes". */
  onBackToSelector?: () => void;
}

export function MazeHuntPanel({
  initialThemeId,
  initialDifficulty,
  onBackToSelector,
}: MazeHuntPanelProps) {
  const [themes, setThemes] = useState<MazeHuntTheme[]>([]);
  const [catalog, setCatalog] = useState<CatalogFile | null>(null);
  const [activeThemeId, setActiveThemeId] = useState<string>(
    initialThemeId ?? "end-island",
  );
  const [difficulty, setDifficulty] = useState<DifficultyPreset>(
    initialDifficulty ?? "medium",
  );
  const [bwSafe, setBwSafe] = useState(false);
  const [splitOntoTwoPages, setSplitOntoTwoPages] = useState(false);
  const [sessionLabel, setSessionLabel] = useState("");
  const [overrides, setOverrides] = useState<
    Partial<Record<ObjectiveSlot, string>>
  >({});
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
    fetch("/items.json", { cache: "default" })
      .then((res) => res.json())
      .then((data: unknown) => {
        if (cancelled) return;
        if (isCatalogFile(data)) {
          setCatalog(data);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Non-fatal: objectives composer will still emit text but plurals may
        // fall back to default rules.
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

  // Overrides are kept sticky-by-theme. Switching the theme via the dropdown
  // clears them in the change handler (not in an effect — see React rule
  // react-hooks/set-state-in-effect), since overrides reference theme-specific
  // items ("ender crystals" in End Island isn't a thing in Nether). Per F6 §4.
  function changeActiveTheme(nextThemeId: string): void {
    setActiveThemeId(nextThemeId);
    setOverrides({});
  }

  function setOverrideFor(slot: ObjectiveSlot, value: string): void {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value.trim().length === 0) {
        delete next[slot];
      } else {
        next[slot] = value;
      }
      return next;
    });
  }

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

      // Boss center cell.
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

      setStatus("Composing objectives...");
      const catalogLookup: CatalogLookup =
        catalog !== null
          ? buildCatalogLookup(catalog)
          : { findAsset: () => undefined };
      const objectives = composeObjectives({
        theme: activeTheme,
        placementsByItem: placement.placementsByItem,
        assembly,
        catalog: catalogLookup,
        overrides,
      });

      setStatus("Rendering PDF...");
      const { buildMazeHuntPdf } = await import("@/lib/pdf/mazeHunt");
      const themeLabel = activeTheme.displayName;
      const cutoutSize =
        diff.cutoutSize === "small"
          ? "small"
          : diff.cutoutSize === "large"
            ? "large"
            : "medium";
      const pdfBytes = await buildMazeHuntPdf({
        grid,
        theme: { id: activeTheme.id, displayName: activeTheme.displayName },
        difficulty,
        collectibles: placement.placements,
        placementsByItem: placement.placementsByItem,
        boss,
        assembly,
        cutoutSize,
        spriteBytes,
        objectives,
        blackAndWhiteSafe: bwSafe,
        splitOntoTwoPages,
        sessionLabel,
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
        objectives,
      });
      committed = true;
      const mismatchCount = objectives.filter(
        (o) => o.countMismatch !== undefined,
      ).length;
      const mismatchSuffix =
        mismatchCount > 0
          ? ` ⚠ ${mismatchCount} objective${mismatchCount === 1 ? "" : "s"} have a count mismatch — review before printing.`
          : "";
      setStatus(
        `Preview ready — ${placement.totalCount} collectibles placed, ${grid.walls.length} walls, ${objectives.length} objectives. Confirm to download.${mismatchSuffix}`,
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

  // For each slot we expose at most one override input. For multi-item
  // navigate themes (Nether), the override applies to the FIRST navigate
  // line only — see composeObjectives() comment.
  const editableSlots: ObjectiveSlot[] = [
    "navigate",
    "find",
    "escape",
    "craft",
    "state-change",
  ];

  const activeThemeLabel =
    themes.find((t) => t.id === activeThemeId)?.displayName ?? "Maze Hunt";

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      {onBackToSelector ? (
        <button
          type="button"
          onClick={onBackToSelector}
          className="cursor-pointer self-start text-sm font-medium text-[var(--accent)] hover:underline"
        >
          ← Back to themes
        </button>
      ) : null}
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
          Maze Hunt
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight text-[var(--heading)]">
          {activeThemeLabel} worksheet
        </h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Generate a printable Letter portrait worksheet — child copy on the
          top half, facilitator answer key on the bottom half. Adjust theme,
          difficulty, and per-objective text below before generating.
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
                onChange={(e) => changeActiveTheme(e.target.value)}
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
            <div>
              <label
                htmlFor="session-label"
                className="block text-sm font-medium text-[var(--heading)]"
              >
                Session label (optional)
              </label>
              <input
                id="session-label"
                type="text"
                value={sessionLabel}
                onChange={(e) => setSessionLabel(e.target.value)}
                disabled={isGenerating}
                placeholder="e.g. Tuesday group, Cohort A"
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base"
              />
            </div>
            <div className="flex flex-wrap gap-6">
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
                  checked={splitOntoTwoPages}
                  onChange={(e) => setSplitOntoTwoPages(e.target.checked)}
                  disabled={isGenerating}
                />
                <span>Split onto two pages (answer key off-page)</span>
              </label>
            </div>
            <details className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-sm">
              <summary className="cursor-pointer font-medium text-[var(--heading)]">
                Objective overrides (optional)
              </summary>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Leave blank to use the theme defaults. Override text is
                rendered verbatim. The composer flags any number in the
                override that disagrees with the live placement count.
              </p>
              <div className="mt-3 space-y-2">
                {editableSlots.map((slot) => (
                  <div key={slot} className="flex flex-col gap-1">
                    <label
                      htmlFor={`ov-${slot}`}
                      className="text-xs font-medium text-[var(--muted)]"
                    >
                      {SLOT_LABELS[slot]}
                    </label>
                    <input
                      id={`ov-${slot}`}
                      type="text"
                      value={overrides[slot] ?? ""}
                      onChange={(e) => setOverrideFor(slot, e.target.value)}
                      disabled={isGenerating}
                      placeholder="(use theme default)"
                      className="w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
                    />
                  </div>
                ))}
              </div>
            </details>
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
            <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--panel)] p-3">
              <h3 className="text-sm font-semibold text-[var(--heading)]">
                Composed objectives
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {pdf.objectives.map((o, i) => (
                  <li
                    key={`${o.slot}-${i}`}
                    className="flex items-start gap-2"
                  >
                    <span
                      className="mt-0.5 inline-block h-3 w-3 flex-shrink-0 rounded-sm border border-[var(--border)] bg-white"
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                        {SLOT_LABELS[o.slot]}
                        {o.isOverride ? " (override)" : ""}
                      </span>
                      <br />
                      <span>{o.text}</span>
                      {o.countMismatch ? (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          <span aria-hidden="true">⚠</span>
                          Override count{" "}
                          {o.countMismatch.foundInOverride ?? "(none)"} /
                          maze count {o.countMismatch.expected}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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
  );
}

/**
 * Resolve the static thumbnail path for a canonicalName by trying each known
 * directory. We don't have direct access to the catalog at component-mount
 * time, so we encode the slug rule (lowercase, strip parens) and rely on the
 * server to 404 when the asset is in a different directory.
 *
 * Maze Hunt v1 always uses entities for bosses (entities/), blocks for
 * collectibles (blocks/), and items only for Pixel Puzzle.
 */
function canonicalPath(canonicalName: string): string {
  const slug = canonicalName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/'/g, "");
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
  return `/blocks/${slug}.png`;
}
