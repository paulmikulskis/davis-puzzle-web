// Local preset library for the Maze Hunt editor.
//
// Storage model: a two-tier localStorage layout per `plan.md` §7.10.
//   - `davis.mazehunt.preset.index` — JSON array of `PresetIndexEntry`,
//     read on every list render.
//   - `davis.mazehunt.preset.{id}`   — full `MazeHuntPreset` blob.
//
// The split lets the panel render a 30-row list without rehydrating ~700 KB
// of preset blobs. The index is treated as authoritative on load — orphan
// entries (index says "preset X" but the blob key is missing) are filtered
// out lazily; we never try to rebuild the index from scattered keys.
//
// All persistence is browser-local; F8 is intentionally cross-device-sync-free
// (see `web/CLAUDE.md` non-negotiables and Feature 8 spec §6).
//
// Migration scaffolding lives next to the schema definition so a future field
// change can't ship without the migrator. v1 has nothing to migrate; the
// chain is here so v2 has a hook to slot into.

import { PuzzleError } from "@/lib/errors";

export const PRESET_SCHEMA_VERSION = 1;
export type PresetSchemaVersion = 1;

const INDEX_KEY = "davis.mazehunt.preset.index";
const PRESET_KEY_PREFIX = "davis.mazehunt.preset.";

// ---------------------------------------------------------------------------
// Algorithm-version pinning
// ---------------------------------------------------------------------------

/**
 * Pinned per-feature algorithm versions so old presets stay reproducible if
 * F2/F4/F5/F6 generators change between releases. v1 just declares them; the
 * editor will route old presets through matching versions in the future.
 */
export interface PresetAlgoVersions {
  maze: number;
  placement: number;
  assembly: number;
  objectives: number;
}

export const CURRENT_ALGO_VERSIONS: PresetAlgoVersions = {
  maze: 1,
  placement: 1,
  assembly: 1,
  objectives: 1,
};

// ---------------------------------------------------------------------------
// Preset shape
// ---------------------------------------------------------------------------

export type PresetDifficulty = "easy" | "medium" | "hard";

export interface MazeHuntPresetConfig {
  themeId: string;
  difficulty: PresetDifficulty;
  /** Optional per-objective overrides keyed by slot id (e.g. "navigate"). */
  overrides?: Record<string, string>;
  bwSafe: boolean;
  splitOntoTwoPages: boolean;
  /**
   * Config seed. Drives any deterministic state that should reload identically
   * (e.g. assembly slot order, objective phrasing tiebreaks).
   */
  configSeed: string;
  /**
   * Run seed. Present only when `lockSeeds === true`; otherwise generated
   * fresh on each Generate so Andrew can re-roll for each kid in a group.
   */
  runSeed?: string;
  lockSeeds: boolean;
  sessionLabel: string;
}

export interface MazeHuntPreset {
  _schema: PresetSchemaVersion;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastPrintedAt?: string;
  note?: string;
  algoVersions: PresetAlgoVersions;
  config: MazeHuntPresetConfig;
}

export interface PresetIndexEntry {
  id: string;
  name: string;
  /** Human-readable difficulty descriptor, e.g. "End Island - Medium". */
  difficultyDescriptor: string;
  lastPrintedAt?: string;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isPresetDifficulty(value: unknown): value is PresetDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isAlgoVersions(value: unknown): value is PresetAlgoVersions {
  if (!isStringRecord(value)) return false;
  return (
    typeof value.maze === "number" &&
    typeof value.placement === "number" &&
    typeof value.assembly === "number" &&
    typeof value.objectives === "number"
  );
}

function isOverridesMap(value: unknown): value is Record<string, string> {
  if (value === undefined) return true;
  if (!isStringRecord(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== "string") return false;
  }
  return true;
}

function isPresetConfig(value: unknown): value is MazeHuntPresetConfig {
  if (!isStringRecord(value)) return false;
  if (typeof value.themeId !== "string") return false;
  if (!isPresetDifficulty(value.difficulty)) return false;
  if (!isOverridesMap(value.overrides)) return false;
  if (typeof value.bwSafe !== "boolean") return false;
  if (typeof value.splitOntoTwoPages !== "boolean") return false;
  if (typeof value.configSeed !== "string") return false;
  if (!isOptionalString(value.runSeed)) return false;
  if (typeof value.lockSeeds !== "boolean") return false;
  if (typeof value.sessionLabel !== "string") return false;
  return true;
}

export function isMazeHuntPreset(value: unknown): value is MazeHuntPreset {
  if (!isStringRecord(value)) return false;
  if (value._schema !== PRESET_SCHEMA_VERSION) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.createdAt !== "string") return false;
  if (typeof value.updatedAt !== "string") return false;
  if (!isOptionalString(value.lastPrintedAt)) return false;
  if (!isOptionalString(value.note)) return false;
  if (!isAlgoVersions(value.algoVersions)) return false;
  if (!isPresetConfig(value.config)) return false;
  return true;
}

function isPresetIndexEntry(value: unknown): value is PresetIndexEntry {
  if (!isStringRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.difficultyDescriptor !== "string") return false;
  if (!isOptionalString(value.lastPrintedAt)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Migration scaffolding
// ---------------------------------------------------------------------------

type Migrator = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Chain of migrators keyed by the source schema version.
 * `MIGRATORS[1]` would lift a v1 preset to v2 when v2 ships.
 *
 * v1 has nothing to migrate from; the table exists so adding a v2 field
 * forces a teammate to also add the corresponding migrator entry.
 */
const MIGRATORS: Record<number, Migrator> = {};

/**
 * Walks `raw` through the migration chain up to `PRESET_SCHEMA_VERSION`.
 * Throws a friendly `PuzzleError` if the input declares a newer schema than
 * we know how to read, or is fundamentally malformed.
 */
export function migratePreset(raw: unknown): MazeHuntPreset {
  if (!isStringRecord(raw)) {
    throw new PuzzleError(
      "bad-input",
      "Preset payload is not a JSON object.",
    );
  }
  const schemaRaw = raw._schema;
  if (typeof schemaRaw !== "number") {
    throw new PuzzleError(
      "bad-input",
      "Preset is missing a `_schema` version.",
    );
  }
  if (schemaRaw > PRESET_SCHEMA_VERSION) {
    throw new PuzzleError(
      "bad-input",
      `Preset was made with a newer version of the app (schema v${schemaRaw}). Update the app and try again.`,
    );
  }

  let current: Record<string, unknown> = raw;
  let version = schemaRaw;
  while (version < PRESET_SCHEMA_VERSION) {
    const migrate = MIGRATORS[version];
    if (!migrate) {
      throw new PuzzleError(
        "bad-input",
        `No migrator from preset schema v${version}.`,
      );
    }
    current = migrate(current);
    version += 1;
  }

  if (!isMazeHuntPreset(current)) {
    throw new PuzzleError(
      "bad-input",
      "Preset failed validation after migration.",
    );
  }
  return current;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function presetKey(id: string): string {
  return `${PRESET_KEY_PREFIX}${id}`;
}

function readIndex(storage: Storage): PresetIndexEntry[] {
  const raw = storage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPresetIndexEntry);
  } catch {
    return [];
  }
}

function writeIndex(storage: Storage, index: PresetIndexEntry[]): void {
  try {
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (err) {
    throw new PuzzleError(
      "bad-input",
      "Could not save preset index — your preset library may be full. Try exporting and pruning.",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * UUID v4 via `crypto.randomUUID()`. Falls back to a hand-rolled v4 shape if
 * the runtime lacks `randomUUID` (older Safari on Chromebooks).
 */
export function generatePresetId(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined" && "crypto" in globalThis
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // Fallback: build a v4 from getRandomValues if available, else Math.random.
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Set version (4) and variant (10xx) bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (const b of bytes) {
    hex.push(b.toString(16).padStart(2, "0"));
  }
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Read every preset blob the index points at, returning a sorted index list.
 * Orphan entries (index says X but no blob) are filtered out and the index
 * is rewritten without them — lazy reconciliation per plan.md §7.10.
 *
 * Sorted by `lastPrintedAt` desc, falling back to name asc.
 */
export function listPresets(): PresetIndexEntry[] {
  const storage = getStorage();
  if (!storage) return [];
  const index = readIndex(storage);
  const live: PresetIndexEntry[] = [];
  let pruned = false;
  for (const entry of index) {
    const blob = storage.getItem(presetKey(entry.id));
    if (blob === null) {
      pruned = true;
      continue;
    }
    live.push(entry);
  }
  if (pruned) {
    writeIndex(storage, live);
  }
  return [...live].sort(comparePresetIndexEntries);
}

function comparePresetIndexEntries(
  a: PresetIndexEntry,
  b: PresetIndexEntry,
): number {
  const aTs = a.lastPrintedAt ? Date.parse(a.lastPrintedAt) : 0;
  const bTs = b.lastPrintedAt ? Date.parse(b.lastPrintedAt) : 0;
  if (aTs !== bTs) return bTs - aTs;
  return a.name.localeCompare(b.name);
}

export function loadPreset(id: string): MazeHuntPreset | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(presetKey(id));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  try {
    return migratePreset(parsed);
  } catch {
    return null;
  }
}

/**
 * Build a human-readable difficulty descriptor for the index list, e.g.
 * "End Island - Medium". Pure helper — callers pass the resolved theme label.
 */
export function buildDifficultyDescriptor(
  themeLabel: string,
  difficulty: PresetDifficulty,
): string {
  const cap = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  return `${themeLabel} - ${cap}`;
}

/**
 * Write order per plan.md §7.10:
 *   1. Write `preset.{id}` blob first.
 *   2. Read the index, splice/replace, write it back.
 *
 * This way a tab killed mid-write at most leaves an orphan blob (harmless;
 * `listPresets` ignores anything not in the index). It NEVER leaves an index
 * entry pointing at a missing blob — `listPresets` reconciles those, but the
 * write order makes it rare.
 */
export function savePreset(preset: MazeHuntPreset): void {
  if (!isMazeHuntPreset(preset)) {
    throw new PuzzleError("bad-input", "Refusing to save malformed preset.");
  }
  const storage = getStorage();
  if (!storage) {
    throw new PuzzleError(
      "bad-input",
      "Browser storage is unavailable. Presets cannot be saved here.",
    );
  }

  try {
    storage.setItem(presetKey(preset.id), JSON.stringify(preset));
  } catch (err) {
    throw new PuzzleError(
      "bad-input",
      "Could not save preset — your preset library may be full. Try exporting and pruning.",
      err,
    );
  }

  const index = readIndex(storage);
  const entry = indexEntryFor(preset);
  const existingIdx = index.findIndex((e) => e.id === preset.id);
  if (existingIdx === -1) {
    index.push(entry);
  } else {
    index[existingIdx] = entry;
  }
  writeIndex(storage, index);
}

function indexEntryFor(preset: MazeHuntPreset): PresetIndexEntry {
  return {
    id: preset.id,
    name: preset.name,
    difficultyDescriptor: buildDifficultyDescriptor(
      preset.config.themeId,
      preset.config.difficulty,
    ),
    lastPrintedAt: preset.lastPrintedAt,
  };
}

/**
 * Delete order per plan.md §7.10 (reverse, also non-atomic):
 *   1. Read the index, remove the entry, write it back.
 *   2. Remove `preset.{id}` blob.
 */
export function deletePreset(id: string): void {
  const storage = getStorage();
  if (!storage) return;
  const index = readIndex(storage);
  const next = index.filter((e) => e.id !== id);
  writeIndex(storage, next);
  storage.removeItem(presetKey(id));
}

export function renamePreset(id: string, newName: string): void {
  const trimmed = newName.trim();
  if (trimmed.length === 0) {
    throw new PuzzleError("bad-input", "Preset name cannot be empty.");
  }
  const storage = getStorage();
  if (!storage) return;
  const preset = loadPreset(id);
  if (!preset) {
    throw new PuzzleError("not-found", "Preset no longer exists.");
  }
  const next: MazeHuntPreset = {
    ...preset,
    name: trimmed,
    updatedAt: new Date().toISOString(),
  };
  savePreset(next);
}

export function recordPresetPrint(id: string): void {
  const storage = getStorage();
  if (!storage) return;
  const preset = loadPreset(id);
  if (!preset) return;
  const next: MazeHuntPreset = {
    ...preset,
    lastPrintedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  savePreset(next);
}

/**
 * Convenience builder for callers that want to construct a fresh preset
 * record from the editor's live config without re-deriving timestamps.
 */
export function createPreset(args: {
  name: string;
  config: MazeHuntPresetConfig;
  note?: string;
}): MazeHuntPreset {
  const now = new Date().toISOString();
  return {
    _schema: PRESET_SCHEMA_VERSION,
    id: generatePresetId(),
    name: args.name,
    createdAt: now,
    updatedAt: now,
    note: args.note,
    algoVersions: { ...CURRENT_ALGO_VERSIONS },
    config: { ...args.config },
  };
}
