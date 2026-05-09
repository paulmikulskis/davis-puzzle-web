// Whole-library JSON export/import for the Maze Hunt preset library.
//
// Validation is strict: imported presets must pass the same `isMazeHuntPreset`
// type guard used at runtime, and the surrounding envelope must declare a
// `_schema` we know how to read. We never `eval`. We do not pass unknown
// fields through. Imports are the only ingress for hostile data into the app
// (see Feature 8 spec §5.6) and are treated accordingly.

import {
  PRESET_SCHEMA_VERSION,
  isMazeHuntPreset,
  listPresets,
  loadPreset,
  savePreset,
  type MazeHuntPreset,
  type PresetSchemaVersion,
} from "@/lib/presets";

export interface PresetExportFile {
  _schema: PresetSchemaVersion;
  exportedAt: string;
  presets: MazeHuntPreset[];
}

export type ImportResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; reason: "schema-too-new" | "malformed" | "no-presets" };

export type ImportConflictResolution = "rename" | "replace" | "skip";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function exportAllPresets(): PresetExportFile {
  const index = listPresets();
  const presets: MazeHuntPreset[] = [];
  for (const entry of index) {
    const preset = loadPreset(entry.id);
    if (preset) presets.push(preset);
  }
  return {
    _schema: PRESET_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    presets,
  };
}

/**
 * Trigger a browser download of the entire preset library as JSON. The
 * filename defaults to `davis-mazehunt-presets-YYYY-MM-DD.json`.
 *
 * The blob URL is revoked on the next animation frame; long enough for the
 * synthetic anchor click to start the download in every major browser, short
 * enough that Andrew never accumulates leaked blob URLs over a session.
 */
export function downloadPresetExport(filename?: string): void {
  if (typeof window === "undefined") return;
  const file = exportAllPresets();
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const safeName = filename ?? `davis-mazehunt-presets-${date}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // Defer revoke so the browser has a frame to start the download stream.
  window.requestAnimationFrame(() => {
    URL.revokeObjectURL(url);
  });
}

// ---------------------------------------------------------------------------
// Parse / validate
// ---------------------------------------------------------------------------

function isPresetExportFileEnvelope(value: unknown): value is {
  _schema: number;
  exportedAt: unknown;
  presets: unknown[];
} {
  if (typeof value !== "object" || value === null) return false;
  if (!("_schema" in value) || !("presets" in value)) return false;
  const v = value as { _schema: unknown; presets: unknown };
  return typeof v._schema === "number" && Array.isArray(v.presets);
}

export function parsePresetImport(text: string):
  | { ok: true; file: PresetExportFile }
  | { ok: false; reason: "schema-too-new" | "malformed" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isPresetExportFileEnvelope(parsed)) {
    return { ok: false, reason: "malformed" };
  }
  if (parsed._schema > PRESET_SCHEMA_VERSION) {
    return { ok: false, reason: "schema-too-new" };
  }
  const presets: MazeHuntPreset[] = [];
  for (const entry of parsed.presets) {
    if (isMazeHuntPreset(entry)) presets.push(entry);
  }
  if (presets.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  // Narrow `_schema` to the literal type the export file declares it has.
  const exportedAt =
    typeof parsed.exportedAt === "string"
      ? parsed.exportedAt
      : new Date().toISOString();
  const file: PresetExportFile = {
    _schema: PRESET_SCHEMA_VERSION,
    exportedAt,
    presets,
  };
  return { ok: true, file };
}

// ---------------------------------------------------------------------------
// Apply (with conflict resolution)
// ---------------------------------------------------------------------------

function uniqueRenamedName(
  desired: string,
  existingNames: Set<string>,
): string {
  let candidate = `${desired} (imported)`;
  let n = 2;
  while (existingNames.has(candidate)) {
    candidate = `${desired} (imported ${n})`;
    n += 1;
  }
  return candidate;
}

/**
 * Conflict resolution policy:
 *   - "replace": keep the imported preset's id; overwrite the local copy.
 *   - "rename":  treat the imported preset as a new entry. Same id collision
 *                gets a fresh id; the name gets " (imported)" suffix to keep
 *                Andrew's existing label intact.
 *   - "skip":    leave the local copy alone.
 *
 * Conflicts are matched by `id` first (true duplicate), then by `name`.
 */
export function applyPresetImport(
  file: PresetExportFile,
  resolveConflict: (
    existing: MazeHuntPreset,
    incoming: MazeHuntPreset,
  ) => ImportConflictResolution,
): ImportResult {
  if (file.presets.length === 0) {
    return { ok: false, reason: "no-presets" };
  }
  const localIndex = listPresets();
  const localById = new Map<string, MazeHuntPreset>();
  const localByName = new Map<string, MazeHuntPreset>();
  for (const entry of localIndex) {
    const preset = loadPreset(entry.id);
    if (!preset) continue;
    localById.set(preset.id, preset);
    localByName.set(preset.name, preset);
  }
  const knownNames = new Set<string>(localByName.keys());

  let imported = 0;
  let skipped = 0;
  for (const incoming of file.presets) {
    const existing =
      localById.get(incoming.id) ?? localByName.get(incoming.name) ?? null;

    if (!existing) {
      savePreset(incoming);
      knownNames.add(incoming.name);
      imported += 1;
      continue;
    }

    const decision = resolveConflict(existing, incoming);
    if (decision === "skip") {
      skipped += 1;
      continue;
    }
    if (decision === "replace") {
      // Use the existing id so any references stay stable; otherwise we'd
      // leave a duplicate behind under a different id.
      const replacement: MazeHuntPreset = {
        ...incoming,
        id: existing.id,
        updatedAt: new Date().toISOString(),
      };
      savePreset(replacement);
      imported += 1;
      continue;
    }
    // "rename": import as a new preset with a fresh id and a non-colliding name.
    const renamed: MazeHuntPreset = {
      ...incoming,
      id:
        existing.id === incoming.id
          ? makeFreshId()
          : incoming.id,
      name: uniqueRenamedName(incoming.name, knownNames),
      updatedAt: new Date().toISOString(),
    };
    savePreset(renamed);
    knownNames.add(renamed.name);
    imported += 1;
  }
  return { ok: true, imported, skipped };
}

function makeFreshId(): string {
  // Local copy of `generatePresetId` to avoid a circular import at module
  // top-level — we already pull the rest of the public API from `presets`.
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined" && "crypto" in globalThis
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, "0"));
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
