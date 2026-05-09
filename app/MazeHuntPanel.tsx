"use client";

// Maze Hunt panel — reactive editor + live visualizer.
//
// Knobs (theme, difficulty, BW, split, session label, overrides) update a
// single reactive `liveSnapshot` via useMemo. The visualizer paints the same
// snapshot the PDF builder will commit, so Davis sees what he's building as
// he edits — no "Generate" intermediate step, no stale stats.
//
// Sprite assets are pre-fetched once per theme into in-memory object URLs
// shared by the visualizer and the PDF builder.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  generateMaze,
  type CardinalPosition,
  type CellCountPreset,
  type MazeCell,
  type MazeGrid,
  type MazeStyle,
  type Silhouette,
} from "@/lib/maze";
import type { MazeSilhouette } from "@/lib/mazeHuntThemes";
import { generateSeed } from "@/lib/maze/rng";
import { placeCollectibles, type Placement } from "@/lib/placement";
import { assemblyIdFromKey, getAssembly } from "@/lib/assemblies";
import {
  loadMazeHuntThemes,
  type DifficultyPreset,
  type MazeHuntTheme,
} from "@/lib/mazeHuntThemes";
import {
  buildCatalogLookup,
  composeObjectives,
  type CatalogLookup,
  type Objective,
  type ObjectiveSlot,
} from "@/lib/objectives";
import { isCatalogFile, type CatalogFile } from "@/lib/catalog";
import {
  loadPreset,
  recordPresetPrint,
  savePreset,
  type MazeHuntPreset,
  type MazeHuntPresetConfig,
} from "@/lib/presets";
import { PresetLibrary } from "@/app/PresetLibrary";
import {
  MazeHuntVisualizer,
  type CutoutSize,
  type WorksheetSnapshot,
} from "@/app/MazeHuntVisualizer";

// ---------------------------------------------------------------------------
// Theme → maze plumbing
// ---------------------------------------------------------------------------

function silhouetteForKind(
  kind: MazeSilhouette,
  preset: DifficultyPreset,
): { silhouette: Silhouette; preset: CellCountPreset } {
  const presetMap: Record<DifficultyPreset, CellCountPreset> = {
    easy: "small",
    medium: "medium",
    hard: "large",
  };
  const cellPreset = presetMap[preset];
  if (kind === "rectangle" || kind === "rounded-rectangle") {
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
  if (kind === "circle") {
    const d = cellPreset === "small" ? 14 : cellPreset === "medium" ? 18 : 22;
    return { silhouette: { kind: "circle", diameter: d }, preset: cellPreset };
  }
  if (kind === "diamond-star") {
    const d = cellPreset === "small" ? 14 : cellPreset === "medium" ? 18 : 22;
    return {
      silhouette: { kind: "star4", boundingBox: d },
      preset: cellPreset,
    };
  }
  if (kind === "hexagon") {
    const d = cellPreset === "small" ? 16 : cellPreset === "medium" ? 20 : 24;
    return {
      silhouette: { kind: "hexagon", boundingBox: d },
      preset: cellPreset,
    };
  }
  if (kind === "ring") {
    const d = cellPreset === "small" ? 16 : cellPreset === "medium" ? 20 : 24;
    return { silhouette: { kind: "ring", boundingBox: d }, preset: cellPreset };
  }
  if (kind === "plus") {
    const d = cellPreset === "small" ? 16 : cellPreset === "medium" ? 20 : 24;
    return { silhouette: { kind: "plus", boundingBox: d }, preset: cellPreset };
  }
  // oval — landscape ellipse
  const dims =
    cellPreset === "small"
      ? { width: 16, height: 12 }
      : cellPreset === "medium"
        ? { width: 20, height: 16 }
        : { width: 24, height: 20 };
  return {
    silhouette: { kind: "oval", width: dims.width, height: dims.height },
    preset: cellPreset,
  };
}

function defaultEntranceForKind(kind: MazeSilhouette): CardinalPosition {
  if (kind === "diamond-star") return "N";
  return "S";
}

function defaultExitForKind(kind: MazeSilhouette): CardinalPosition {
  if (kind === "diamond-star") return "S";
  return "N";
}

function findInShapeCenter(grid: MazeGrid): MazeCell | null {
  const cx = Math.floor(grid.cellsAcross / 2);
  const cy = Math.floor(grid.cellsDown / 2);
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

function isObjectiveSlot(value: string): value is ObjectiveSlot {
  return (
    value === "navigate" ||
    value === "find" ||
    value === "escape" ||
    value === "craft" ||
    value === "state-change"
  );
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

function spritePathFor(canonicalName: string): string {
  const slug = canonicalName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/'/g, "");
  if (ENTITY_NAMES.has(canonicalName)) return `/entities/${slug}.png`;
  return `/blocks/${slug}.png`;
}

const SLOT_LABELS: Record<ObjectiveSlot, string> = {
  navigate: "Navigate",
  find: "Find",
  escape: "Escape",
  craft: "Craft",
  "state-change": "State change",
};

const EDITABLE_SLOTS: ObjectiveSlot[] = [
  "navigate",
  "find",
  "escape",
  "craft",
  "state-change",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MazeHuntPanelProps {
  initialThemeId?: string;
  initialDifficulty?: DifficultyPreset;
  onBackToSelector?: () => void;
}

interface PipelineResult {
  ok: true;
  snapshot: WorksheetSnapshot;
  spriteBytes: Record<string, Uint8Array>;
  filename: string;
}

interface PipelineError {
  ok: false;
  message: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  const [lockSeeds, setLockSeeds] = useState(false);
  const [mazeStyle, setMazeStyle] = useState<MazeStyle>("labyrinth");
  const [silhouetteOverride, setSilhouetteOverride] =
    useState<MazeSilhouette | null>(null);

  const [configSeed, setConfigSeed] = useState<string>(() => generateSeed());
  const [placementSalt, setPlacementSalt] = useState<string>(() => "P");
  const [lockedRunSeed, setLockedRunSeed] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Sprite preload: bytes (for PDF) + object URLs (for SVG visualizer).
  const [spriteBytes, setSpriteBytes] = useState<Record<string, Uint8Array>>(
    {},
  );
  const [spriteUrls, setSpriteUrls] = useState<Record<string, string>>({});
  const [spritesLoaded, setSpritesLoaded] = useState(false);

  // Preview view toggle ("two-up" | "child" | "answer").
  const [previewView, setPreviewView] = useState<"two-up" | "child" | "answer">(
    "two-up",
  );

  // Preset wiring.
  const [currentPresetId, setCurrentPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState<string>("");
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Load themes + catalog on mount.
  useEffect(() => {
    let cancelled = false;
    loadMazeHuntThemes()
      .then((data) => {
        if (cancelled) return;
        setThemes(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load themes.");
      });
    fetch("/items.json", { cache: "default" })
      .then((res) => res.json())
      .then((data: unknown) => {
        if (cancelled) return;
        if (isCatalogFile(data)) setCatalog(data);
      })
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTheme = useMemo(
    () => themes.find((t) => t.id === activeThemeId) ?? null,
    [themes, activeThemeId],
  );

  // ----- Sprite preload per theme -----
  useEffect(() => {
    if (!activeTheme) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpritesLoaded(false);
    const refs = new Set<string>();
    for (const c of activeTheme.collectibles) refs.add(c.canonicalName);
    refs.add(activeTheme.boss.canonicalName);
    const assemblyId = assemblyIdFromKey(activeTheme.assembly.key);
    const assembly =
      assemblyId !== null ? getAssembly(assemblyId) : undefined;
    if (assembly) {
      for (const row of assembly.gridShape) {
        for (const slot of row) {
          if (slot.kind === "paste") {
            refs.add(slot.defaultItem);
            refs.add(slot.answerItem);
          } else if (slot.kind === "decorative") {
            refs.add(slot.item);
          }
        }
      }
      for (const cutout of assembly.cutoutPanel) refs.add(cutout.item);
    }
    const pairs: [string, string][] = Array.from(refs).map((ref) => [
      ref,
      spritePathFor(ref),
    ]);
    void Promise.all(
      pairs.map(async ([ref, path]) => {
        const res = await fetch(path);
        if (!res.ok) return [ref, null] as const;
        const buf = await res.arrayBuffer();
        return [ref, new Uint8Array(buf)] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      const bytes: Record<string, Uint8Array> = {};
      const urls: Record<string, string> = {};
      for (const [ref, data] of results) {
        if (data === null) continue;
        bytes[ref] = data;
        const buffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(buffer).set(data);
        const blob = new Blob([buffer], { type: "image/png" });
        urls[ref] = URL.createObjectURL(blob);
      }
      setSpriteBytes(bytes);
      setSpriteUrls((prev) => {
        // Revoke any previous URLs that aren't being kept.
        for (const u of Object.values(prev)) URL.revokeObjectURL(u);
        return urls;
      });
      setSpritesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTheme]);

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const u of Object.values(spriteUrls)) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-clear transient download status messages so the surface stays calm.
  useEffect(() => {
    if (!downloadStatus) return;
    const t = window.setTimeout(() => setDownloadStatus(null), 4500);
    return () => window.clearTimeout(t);
  }, [downloadStatus]);

  // ----- The reactive pipeline -----
  // Recomputed whenever inputs change. Pure computation; sub-100ms typically.
  const pipeline: PipelineResult | PipelineError | null = useMemo(() => {
    if (!activeTheme) return null;
    try {
      const effectiveSilhouette: MazeSilhouette =
        silhouetteOverride ?? activeTheme.silhouette;
      const { silhouette, preset } = silhouetteForKind(
        effectiveSilhouette,
        difficulty,
      );
      const seedToUse = lockSeeds && lockedRunSeed ? lockedRunSeed : configSeed;
      const grid = generateMaze({
        silhouette,
        cellCountPreset: preset,
        entrance: defaultEntranceForKind(effectiveSilhouette),
        exit: defaultExitForKind(effectiveSilhouette),
        seed: seedToUse,
        style: mazeStyle,
      });

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
        seed: grid.seed + placementSalt,
      });
      if (!placement.ok) {
        return {
          ok: false,
          message: `Couldn't place collectibles (${placement.reason}). Try re-rolling or a different difficulty.`,
        };
      }

      const bossCell = findInShapeCenter(grid);
      const boss =
        bossCell !== null
          ? { cell: bossCell, itemRef: activeTheme.boss.canonicalName }
          : undefined;

      const assemblyId = assemblyIdFromKey(activeTheme.assembly.key);
      const assembly =
        assemblyId !== null ? getAssembly(assemblyId) : undefined;

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

      const cutoutSize: CutoutSize =
        diff.cutoutSize === "small"
          ? "small"
          : diff.cutoutSize === "large"
            ? "large"
            : "medium";

      const snapshot: WorksheetSnapshot = {
        grid,
        collectibles: placement.placements,
        boss,
        assembly,
        objectives,
        cutoutSize,
        themeDisplayName: activeTheme.displayName,
        difficulty,
        bwSafe,
        sessionLabel,
        presetName: currentPresetId !== null ? presetName : undefined,
      };
      const filename = `${activeTheme.id}_${difficulty}_${grid.seed}.pdf`;
      return { ok: true, snapshot, spriteBytes, filename };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : "Something went wrong building the worksheet.",
      };
    }
  }, [
    activeTheme,
    difficulty,
    bwSafe,
    sessionLabel,
    overrides,
    configSeed,
    placementSalt,
    lockSeeds,
    lockedRunSeed,
    catalog,
    spriteBytes,
    currentPresetId,
    presetName,
    mazeStyle,
    silhouetteOverride,
  ]);

  // ----- Mutators (each one marks dirty so PresetLibrary knows) -----

  function changeActiveTheme(nextThemeId: string): void {
    setActiveThemeId(nextThemeId);
    setOverrides({});
    setSilhouetteOverride(null);
    setIsDirty(true);
  }

  function setMazeStyleDirty(next: MazeStyle): void {
    setMazeStyle(next);
    setIsDirty(true);
  }

  function setSilhouetteOverrideDirty(next: MazeSilhouette | null): void {
    setSilhouetteOverride(next);
    setIsDirty(true);
  }

  function setDifficultyDirty(next: DifficultyPreset): void {
    setDifficulty(next);
    setIsDirty(true);
  }

  function setBwSafeDirty(next: boolean): void {
    setBwSafe(next);
    setIsDirty(true);
  }

  function setSplitDirty(next: boolean): void {
    setSplitOntoTwoPages(next);
    setIsDirty(true);
  }

  function setSessionLabelDirty(next: string): void {
    setSessionLabel(next);
    setIsDirty(true);
  }

  function setLockSeedsDirty(next: boolean): void {
    setLockSeeds(next);
    setIsDirty(true);
    if (!next) setLockedRunSeed(null);
  }

  function setOverrideFor(slot: ObjectiveSlot, value: string): void {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value.trim().length === 0) delete next[slot];
      else next[slot] = value;
      return next;
    });
    setIsDirty(true);
  }

  function rerollMaze(): void {
    setConfigSeed(generateSeed());
    setLockedRunSeed(null);
    setIsDirty(true);
  }

  function rerollPlacements(): void {
    // Append a counter so the placement seed shifts without disturbing the maze.
    setPlacementSalt((s) => s + ".");
    setIsDirty(true);
  }

  function handleLoadPreset(preset: MazeHuntPreset): void {
    setActiveThemeId(preset.config.themeId);
    setDifficulty(preset.config.difficulty);
    const nextOverrides: Partial<Record<ObjectiveSlot, string>> = {};
    if (preset.config.overrides) {
      for (const [slot, text] of Object.entries(preset.config.overrides)) {
        if (isObjectiveSlot(slot)) nextOverrides[slot] = text;
      }
    }
    setOverrides(nextOverrides);
    setBwSafe(preset.config.bwSafe);
    setSplitOntoTwoPages(preset.config.splitOntoTwoPages);
    setSessionLabel(preset.config.sessionLabel);
    setLockSeeds(preset.config.lockSeeds);
    setConfigSeed(preset.config.configSeed);
    setLockedRunSeed(preset.config.runSeed ?? null);
    setMazeStyle(preset.config.mazeStyle ?? "labyrinth");
    setSilhouetteOverride(preset.config.silhouetteOverride ?? null);
    setCurrentPresetId(preset.id);
    setPresetName(preset.name);
    setIsDirty(false);
    setError(null);
    setDownloadStatus(`Loaded "${preset.name}".`);
  }

  // ----- Live editor config (for PresetLibrary) -----
  const currentConfig: MazeHuntPresetConfig = useMemo(() => {
    const overrideMap: Record<string, string> = {};
    for (const [slot, text] of Object.entries(overrides)) {
      if (typeof text === "string" && text.trim().length > 0) {
        overrideMap[slot] = text;
      }
    }
    return {
      themeId: activeThemeId,
      difficulty,
      overrides: Object.keys(overrideMap).length > 0 ? overrideMap : undefined,
      bwSafe,
      splitOntoTwoPages,
      configSeed,
      runSeed: lockSeeds && lockedRunSeed ? lockedRunSeed : undefined,
      lockSeeds,
      sessionLabel,
      mazeStyle,
      silhouetteOverride: silhouetteOverride ?? undefined,
    };
  }, [
    activeThemeId,
    difficulty,
    overrides,
    bwSafe,
    splitOntoTwoPages,
    configSeed,
    lockSeeds,
    lockedRunSeed,
    sessionLabel,
    mazeStyle,
    silhouetteOverride,
  ]);

  // ----- Download PDF from the live snapshot -----
  async function handleDownload(): Promise<void> {
    if (!pipeline || !pipeline.ok) return;
    setIsDownloading(true);
    setError(null);
    setDownloadStatus("Rendering PDF…");
    try {
      const { buildMazeHuntPdf } = await import("@/lib/pdf/mazeHunt");
      const pdfBytes = await buildMazeHuntPdf({
        grid: pipeline.snapshot.grid,
        theme: {
          id: activeThemeId,
          displayName: pipeline.snapshot.themeDisplayName,
        },
        difficulty,
        collectibles: pipeline.snapshot.collectibles,
        placementsByItem: groupPlacementsByItem(
          pipeline.snapshot.collectibles,
        ),
        boss: pipeline.snapshot.boss,
        assembly: pipeline.snapshot.assembly,
        cutoutSize: pipeline.snapshot.cutoutSize,
        spriteBytes: pipeline.spriteBytes,
        objectives: pipeline.snapshot.objectives,
        blackAndWhiteSafe: bwSafe,
        splitOntoTwoPages,
        sessionLabel,
        presetName:
          currentPresetId !== null ? pipeline.snapshot.presetName : undefined,
      });
      const buffer = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(buffer).set(pdfBytes);
      const blob = new Blob([buffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pipeline.filename;
      a.rel = "noopener";
      document.body.append(a);
      a.click();
      a.remove();
      // Brief delay before revoke for Safari.
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);

      // Lock-seeds plumbing.
      if (lockSeeds && currentPresetId !== null) {
        const presetForUpdate = loadPreset(currentPresetId);
        if (
          presetForUpdate &&
          presetForUpdate.config.runSeed !== pipeline.snapshot.grid.seed
        ) {
          const updated: MazeHuntPreset = {
            ...presetForUpdate,
            updatedAt: new Date().toISOString(),
            config: {
              ...presetForUpdate.config,
              runSeed: pipeline.snapshot.grid.seed,
              lockSeeds: true,
            },
          };
          try {
            savePreset(updated);
            setLockedRunSeed(pipeline.snapshot.grid.seed);
          } catch {
            // Quota errors here are non-fatal.
          }
        }
      }
      if (currentPresetId !== null) {
        try {
          recordPresetPrint(currentPresetId);
        } catch {
          // Non-fatal.
        }
      }

      setIsDirty(false);
      setDownloadStatus(`Downloaded ${pipeline.filename}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "PDF rendering failed.",
      );
      setDownloadStatus(null);
    } finally {
      setIsDownloading(false);
    }
  }

  // ----- Render -----

  const snapshotForView = pipeline?.ok ? pipeline.snapshot : null;
  const mismatchCount =
    snapshotForView?.objectives.filter((o) => o.countMismatch !== undefined)
      .length ?? 0;

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 lg:gap-8">
      {onBackToSelector ? (
        <button
          type="button"
          onClick={onBackToSelector}
          className="cursor-pointer self-start text-sm font-medium text-[var(--accent)] transition hover:underline"
        >
          ← Back to themes
        </button>
      ) : null}

      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
          Maze Hunt
        </p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight text-[var(--heading)] sm:text-3xl">
          {activeTheme?.displayName ?? "Loading…"} worksheet
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Adjust the knobs on the left and the preview on the right repaints
          live. Re-roll for a new layout. Download when you&rsquo;re happy.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-start">
        {/* Editor column */}
        <div className="flex flex-col gap-4">
          <ControlsCard
            themes={themes}
            activeThemeId={activeThemeId}
            onThemeChange={changeActiveTheme}
            difficulty={difficulty}
            onDifficultyChange={setDifficultyDirty}
            sessionLabel={sessionLabel}
            onSessionLabelChange={setSessionLabelDirty}
            bwSafe={bwSafe}
            onBwSafeChange={setBwSafeDirty}
            splitOntoTwoPages={splitOntoTwoPages}
            onSplitChange={setSplitDirty}
            lockSeeds={lockSeeds}
            onLockSeedsChange={setLockSeedsDirty}
            mazeStyle={mazeStyle}
            onMazeStyleChange={setMazeStyleDirty}
            silhouetteOverride={silhouetteOverride}
            onSilhouetteOverrideChange={setSilhouetteOverrideDirty}
            themeSilhouette={activeTheme?.silhouette ?? "circle"}
          />

          <RollAndDownloadCard
            onRerollMaze={rerollMaze}
            onRerollPlacements={rerollPlacements}
            onDownload={handleDownload}
            disabled={!snapshotForView || !spritesLoaded}
            isDownloading={isDownloading}
            seed={snapshotForView?.grid.seed ?? "—"}
            mismatchCount={mismatchCount}
            downloadStatus={downloadStatus}
            error={error ?? (pipeline && !pipeline.ok ? pipeline.message : null)}
          />

          <details className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
            <summary className="cursor-pointer select-none text-sm font-semibold text-[var(--heading)]">
              Objective overrides (optional)
            </summary>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Leave blank for theme defaults. Override text is rendered
              verbatim. The composer flags any number that disagrees with the
              live placement count.
            </p>
            <div className="mt-3 space-y-2">
              {EDITABLE_SLOTS.map((slot) => (
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
                    placeholder="(use theme default)"
                    className="w-full rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
                  />
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
            <summary className="cursor-pointer select-none text-sm font-semibold text-[var(--heading)]">
              Preset library
              {currentPresetId !== null ? (
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                  loaded: {presetName}
                  {isDirty ? " (modified)" : ""}
                </span>
              ) : null}
            </summary>
            <div className="mt-3">
              <PresetLibrary
                currentConfig={currentConfig}
                isDirty={isDirty}
                onLoad={handleLoadPreset}
              />
            </div>
          </details>
        </div>

        {/* Visualizer column */}
        <PreviewColumn
          snapshot={snapshotForView}
          spriteUrls={spriteUrls}
          spritesLoaded={spritesLoaded}
          previewView={previewView}
          onPreviewViewChange={setPreviewView}
          mismatchCount={mismatchCount}
          splitOntoTwoPages={splitOntoTwoPages}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupPlacementsByItem(
  placements: Placement[],
): Record<string, Placement[]> {
  const grouped: Record<string, Placement[]> = {};
  for (const p of placements) {
    const list = grouped[p.itemRef];
    if (list) list.push(p);
    else grouped[p.itemRef] = [p];
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Controls card
// ---------------------------------------------------------------------------

interface ControlsCardProps {
  themes: MazeHuntTheme[];
  activeThemeId: string;
  onThemeChange: (id: string) => void;
  difficulty: DifficultyPreset;
  onDifficultyChange: (next: DifficultyPreset) => void;
  sessionLabel: string;
  onSessionLabelChange: (next: string) => void;
  bwSafe: boolean;
  onBwSafeChange: (next: boolean) => void;
  splitOntoTwoPages: boolean;
  onSplitChange: (next: boolean) => void;
  lockSeeds: boolean;
  onLockSeedsChange: (next: boolean) => void;
  mazeStyle: MazeStyle;
  onMazeStyleChange: (next: MazeStyle) => void;
  silhouetteOverride: MazeSilhouette | null;
  onSilhouetteOverrideChange: (next: MazeSilhouette | null) => void;
  themeSilhouette: MazeSilhouette;
}

const MAZE_STYLE_OPTIONS: { value: MazeStyle; label: string; hint: string }[] = [
  {
    value: "labyrinth",
    label: "Labyrinth",
    hint: "Long winding corridors",
  },
  { value: "balanced", label: "Balanced", hint: "Even branching" },
  { value: "branchy", label: "Branchy", hint: "Many short dead-ends" },
];

const SILHOUETTE_OPTIONS: { value: MazeSilhouette; label: string }[] = [
  { value: "circle", label: "Circle" },
  { value: "rectangle", label: "Rectangle" },
  { value: "diamond-star", label: "4-point star" },
  { value: "hexagon", label: "Hexagon" },
  { value: "ring", label: "Ring (donut)" },
  { value: "plus", label: "Plus" },
  { value: "oval", label: "Oval" },
];

function silhouetteLabel(s: MazeSilhouette): string {
  return SILHOUETTE_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

function isMazeSilhouetteValue(value: string): value is MazeSilhouette {
  return SILHOUETTE_OPTIONS.some((o) => o.value === value);
}

function ControlsCard(props: ControlsCardProps) {
  const handleDifficulty = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (next === "easy" || next === "medium" || next === "hard") {
      props.onDifficultyChange(next);
    }
  };
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="theme"
              className="block text-sm font-medium text-[var(--heading)]"
            >
              Theme
            </label>
            <select
              id="theme"
              value={props.activeThemeId}
              onChange={(e) => props.onThemeChange(e.target.value)}
              disabled={props.themes.length === 0}
              className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
            >
              {props.themes.map((t) => (
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
              value={props.difficulty}
              onChange={handleDifficulty}
              className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>
        <div>
          <label
            htmlFor="maze-style"
            className="block text-sm font-medium text-[var(--heading)]"
          >
            Maze style
          </label>
          <div
            id="maze-style"
            role="radiogroup"
            aria-label="Maze style"
            className="mt-1.5 grid grid-cols-3 gap-1 rounded-md border border-[var(--border)] bg-[var(--panel)] p-1"
          >
            {MAZE_STYLE_OPTIONS.map((opt) => {
              const active = props.mazeStyle === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => props.onMazeStyleChange(opt.value)}
                  className={`flex flex-col items-center gap-0.5 rounded px-2 py-1.5 text-xs font-medium transition ${
                    active
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--muted)] hover:bg-white hover:text-[var(--heading)]"
                  }`}
                  title={opt.hint}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`text-[10px] font-normal ${
                      active ? "text-white/80" : "text-[var(--muted)]"
                    }`}
                  >
                    {opt.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label
            htmlFor="silhouette"
            className="block text-sm font-medium text-[var(--heading)]"
          >
            Silhouette
          </label>
          <select
            id="silhouette"
            value={props.silhouetteOverride ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") props.onSilhouetteOverrideChange(null);
              else if (isMazeSilhouetteValue(v))
                props.onSilhouetteOverrideChange(v);
            }}
            className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
          >
            <option value="">
              Theme default ({silhouetteLabel(props.themeSilhouette)})
            </option>
            {SILHOUETTE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
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
            value={props.sessionLabel}
            onChange={(e) => props.onSessionLabelChange(e.target.value)}
            placeholder="e.g. Tuesday group, Cohort A"
            className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base transition focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]"
          />
        </div>
        <div className="grid gap-2 pt-1">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.bwSafe}
              onChange={(e) => props.onBwSafeChange(e.target.checked)}
              className="mt-1"
            />
            <span>
              <strong>Black-and-white safe path</strong>
              <span className="block text-xs text-[var(--muted)]">
                Recommended for school printers — replaces red answer-key line
                with dashed black so it stays visible against the maze walls.
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.splitOntoTwoPages}
              onChange={(e) => props.onSplitChange(e.target.checked)}
            />
            <span>Split onto two pages (answer key off-page)</span>
          </label>
          <label
            className="flex items-center gap-2 text-sm"
            title="Reproduce the exact same maze on every load. Off by default so each generate gives a fresh layout."
          >
            <input
              type="checkbox"
              checked={props.lockSeeds}
              onChange={(e) => props.onLockSeedsChange(e.target.checked)}
            />
            <span>Lock seeds</span>
          </label>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reroll + download card
// ---------------------------------------------------------------------------

interface RollAndDownloadCardProps {
  onRerollMaze: () => void;
  onRerollPlacements: () => void;
  onDownload: () => void;
  disabled: boolean;
  isDownloading: boolean;
  seed: string;
  mismatchCount: number;
  downloadStatus: string | null;
  error: string | null;
}

function RollAndDownloadCard(props: RollAndDownloadCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={props.onRerollMaze}
          disabled={props.disabled}
          className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--heading)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          ↻ Re-roll maze
        </button>
        <button
          type="button"
          onClick={props.onRerollPlacements}
          disabled={props.disabled}
          className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--heading)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          ↻ Re-roll items
        </button>
      </div>
      <button
        type="button"
        onClick={props.onDownload}
        disabled={props.disabled || props.isDownloading}
        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {props.isDownloading ? (
          <>
            <span className="davis-spinner" aria-hidden="true" />
            <span>Rendering PDF…</span>
          </>
        ) : (
          "Download PDF"
        )}
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>
          Seed: <span className="font-mono">{props.seed}</span>
        </span>
        {props.mismatchCount > 0 ? (
          <span className="font-medium text-amber-700">
            ⚠ {props.mismatchCount} objective
            {props.mismatchCount === 1 ? "" : "s"} have a count mismatch
          </span>
        ) : null}
      </div>
      {props.downloadStatus ? (
        <p
          aria-live="polite"
          className="mt-2 text-xs text-[var(--muted)]"
        >
          {props.downloadStatus}
        </p>
      ) : null}
      {props.error ? (
        <p
          aria-live="polite"
          className="mt-2 rounded-md border border-[var(--error)]/40 bg-[var(--error)]/5 px-2 py-1.5 text-xs text-[var(--error)]"
        >
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview column
// ---------------------------------------------------------------------------

interface PreviewColumnProps {
  snapshot: WorksheetSnapshot | null;
  spriteUrls: Record<string, string>;
  spritesLoaded: boolean;
  previewView: "two-up" | "child" | "answer";
  onPreviewViewChange: (next: "two-up" | "child" | "answer") => void;
  mismatchCount: number;
  splitOntoTwoPages: boolean;
}

function PreviewColumn({
  snapshot,
  spriteUrls,
  spritesLoaded,
  previewView,
  onPreviewViewChange,
  mismatchCount,
  splitOntoTwoPages,
}: PreviewColumnProps) {
  // Sticky preview on wide screens — Davis sees the worksheet as he edits.
  const stickyRef = useRef<HTMLDivElement | null>(null);
  // Apply sticky offset on layout so it doesn't fight scroll restore.
  useLayoutEffect(() => {
    if (stickyRef.current) {
      stickyRef.current.style.top = "1rem";
    }
  }, []);

  const views: ("two-up" | "child" | "answer")[] = ["two-up", "child", "answer"];
  const viewLabels: Record<"two-up" | "child" | "answer", string> = {
    "two-up": "Two-up",
    child: "Child copy",
    answer: "Answer key",
  };

  return (
    <div ref={stickyRef} className="lg:sticky">
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Preview
            </span>
            <span className="text-sm font-medium text-[var(--heading)]">
              {snapshot
                ? `${snapshot.themeDisplayName} · ${snapshot.difficulty}`
                : "Loading…"}
            </span>
            {splitOntoTwoPages ? (
              <span className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                PDF prints on 2 pages
              </span>
            ) : null}
          </div>
          <div
            role="tablist"
            aria-label="Preview view"
            className="flex gap-1 rounded-md border border-[var(--border)] bg-white p-1 text-xs font-medium"
          >
            {views.map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={previewView === v}
                onClick={() => onPreviewViewChange(v)}
                className={`min-h-[28px] rounded px-2.5 py-1 transition ${
                  previewView === v
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--heading)]"
                }`}
              >
                {viewLabels[v]}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-[var(--background)] p-3 sm:p-5">
          {snapshot && spritesLoaded ? (
            <MazeHuntVisualizer
              snapshot={snapshot}
              spriteUrls={spriteUrls}
              view={previewView}
            />
          ) : (
            <SkeletonPreview />
          )}
        </div>
        {snapshot ? (
          <div className="border-t border-[var(--border)] bg-white px-4 py-3 text-xs text-[var(--muted)]">
            <ObjectivesInline
              objectives={snapshot.objectives}
              mismatchCount={mismatchCount}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SkeletonPreview() {
  return (
    <div
      className="aspect-[612/792] w-full max-w-3xl animate-pulse rounded-md border border-[var(--border)] bg-white"
      aria-label="Preview loading"
    />
  );
}

interface ObjectivesInlineProps {
  objectives: Objective[];
  mismatchCount: number;
}

function ObjectivesInline({ objectives, mismatchCount }: ObjectivesInlineProps) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Objectives ({objectives.length})
        </span>
        {mismatchCount > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
            ⚠ {mismatchCount} mismatch
          </span>
        ) : null}
      </div>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-[var(--foreground)]">
        {objectives.map((o, i) => (
          <li key={i} className={o.countMismatch ? "text-amber-700" : ""}>
            <span className="text-[var(--muted)]">
              [{SLOT_LABELS[o.slot]}
              {o.isOverride ? " · override" : ""}]
            </span>{" "}
            {o.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
