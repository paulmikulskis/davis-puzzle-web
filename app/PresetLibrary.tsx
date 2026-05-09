"use client";

// Local preset library UI for the Maze Hunt panel.
//
// Sections:
//   - Save preset row     : name input + Save button (uses the live editor config).
//   - Library list        : sorted last-printed-desc; per-row Load / Rename / Delete.
//   - Settings strip      : Export presets / Import presets.
//
// Per `plan.md` §10 R2 (unsaved-editor-state guard): Load must confirm if the
// editor has unsaved changes since the last Generate or Load. Save / Rename /
// Delete don't need the guard — Save is the user *committing* the dirty state,
// Delete and Rename don't replace the editor state.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPreset,
  deletePreset,
  listPresets,
  loadPreset,
  recordPresetPrint,
  renamePreset,
  savePreset,
  type MazeHuntPreset,
  type MazeHuntPresetConfig,
  type PresetIndexEntry,
} from "@/lib/presets";
import {
  applyPresetImport,
  downloadPresetExport,
  parsePresetImport,
  type ImportConflictResolution,
} from "@/lib/presetIO";

export interface PresetLibraryProps {
  /** Current editor configuration; what `Save preset` will write. */
  currentConfig: MazeHuntPresetConfig;
  /** True when the editor has been modified since the last Load or Generate. */
  isDirty: boolean;
  /** Parent rehydrates its own state from this preset. */
  onLoad: (preset: MazeHuntPreset) => void;
  /** Optional: parent calls this after a Generate that came from a preset. */
  onPrintRecorded?: (presetId: string) => void;
}

interface ConflictPrompt {
  existing: MazeHuntPreset;
  incoming: MazeHuntPreset;
  resolve: (decision: ImportConflictResolution) => void;
}

interface DeletePrompt {
  id: string;
  name: string;
}

interface RenameState {
  id: string;
  draft: string;
}

function formatDate(iso?: string): string {
  if (!iso) return "never";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "never";
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

export function PresetLibrary(props: PresetLibraryProps): React.JSX.Element {
  const { currentConfig, isDirty, onLoad } = props;
  // `onPrintRecorded` is part of the public contract per the F8 spec but is
  // currently consumed by the parent directly via `recordPresetPrint`. Held in
  // the type so future revisions can wire a library-internal "you just printed
  // this preset" badge without changing the prop surface.
  void props.onPrintRecorded;
  const [entries, setEntries] = useState<PresetIndexEntry[]>([]);
  const [presetName, setPresetName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [confirmLoadId, setConfirmLoadId] = useState<string | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null);
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [conflict, setConflict] = useState<ConflictPrompt | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function refresh(): void {
    setEntries(listPresets());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  // ---------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------
  function handleSave(): void {
    const trimmed = presetName.trim();
    if (trimmed.length === 0) {
      setSaveError("Give the preset a name.");
      return;
    }
    setSaveError(null);
    try {
      const preset = createPreset({
        name: trimmed,
        config: currentConfig,
      });
      savePreset(preset);
      setPresetName("");
      refresh();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save preset.",
      );
    }
  }

  // ---------------------------------------------------------------------
  // Load (with dirty-guard)
  // ---------------------------------------------------------------------
  function requestLoad(id: string): void {
    if (isDirty) {
      setConfirmLoadId(id);
      return;
    }
    actuallyLoad(id);
  }

  function actuallyLoad(id: string): void {
    const preset = loadPreset(id);
    if (!preset) {
      setSaveError("That preset is no longer available.");
      refresh();
      return;
    }
    setConfirmLoadId(null);
    onLoad(preset);
  }

  // ---------------------------------------------------------------------
  // Rename
  // ---------------------------------------------------------------------
  function startRename(entry: PresetIndexEntry): void {
    setRenaming({ id: entry.id, draft: entry.name });
  }

  function commitRename(): void {
    if (!renaming) return;
    try {
      renamePreset(renaming.id, renaming.draft);
      setRenaming(null);
      refresh();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not rename preset.",
      );
    }
  }

  // ---------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------
  function confirmDelete(): void {
    if (!deletePrompt) return;
    deletePreset(deletePrompt.id);
    setDeletePrompt(null);
    refresh();
  }

  // ---------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------
  function handleExport(): void {
    if (entries.length === 0) {
      setImportError("Nothing to export yet.");
      setImportStatus(null);
      return;
    }
    setImportError(null);
    setImportStatus(null);
    downloadPresetExport();
  }

  function triggerImport(): void {
    fileInputRef.current?.click();
  }

  async function onImportFileChosen(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    setImportError(null);
    setImportStatus(null);
    if (file.size > 1_048_576) {
      setImportError("File is too large to be a legitimate preset library.");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportError("Could not read that file.");
      return;
    }
    const parsed = parsePresetImport(text);
    if (!parsed.ok) {
      if (parsed.reason === "schema-too-new") {
        setImportError(
          "This preset file was made with a newer version of the app.",
        );
      } else {
        setImportError("This file isn't a valid preset library.");
      }
      return;
    }
    // Pump each conflict through the in-app modal one at a time. The conflict
    // resolver returned to `applyPresetImport` has to be synchronous, so we
    // pre-resolve every conflict by walking the incoming list ourselves, then
    // pass a memoized lookup down.
    const decisions = new Map<string, ImportConflictResolution>();
    for (const incoming of parsed.file.presets) {
      const existing =
        listPresets()
          .map((e) => loadPreset(e.id))
          .filter((p): p is MazeHuntPreset => p !== null)
          .find((p) => p.id === incoming.id || p.name === incoming.name) ??
        null;
      if (!existing) continue;
      const decision = await new Promise<ImportConflictResolution>(
        (resolve) => {
          setConflict({
            existing,
            incoming,
            resolve: (d) => resolve(d),
          });
        },
      );
      decisions.set(incoming.id, decision);
    }

    const result = applyPresetImport(parsed.file, (existing, incoming) => {
      void existing;
      return decisions.get(incoming.id) ?? "skip";
    });
    if (!result.ok) {
      setImportError(
        result.reason === "no-presets"
          ? "That file doesn't contain any presets."
          : "That file isn't a valid preset library.",
      );
    } else {
      const skipNote =
        result.skipped > 0 ? ` (${result.skipped} skipped)` : "";
      setImportStatus(`Imported ${result.imported} preset(s)${skipNote}.`);
      refresh();
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  return (
    <div className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label
          htmlFor="preset-name"
          className="block text-sm font-medium text-[var(--heading)] sm:flex-1"
        >
          Preset name
          <input
            id="preset-name"
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="e.g. Tuesday-Class-EndIsland-Easy"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base font-normal"
          />
        </label>
        <button
          type="button"
          onClick={handleSave}
          className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
        >
          Save preset
        </button>
      </div>
      {saveError ? (
        <p className="text-sm text-[var(--error)]">{saveError}</p>
      ) : null}
      <p className="text-xs text-[var(--muted)]">
        Presets live in this browser only. Use Export to back them up.
      </p>

      <PresetList
        entries={entries}
        renaming={renaming}
        onLoad={requestLoad}
        onStartRename={startRename}
        onRenameDraft={(draft) =>
          setRenaming((prev) => (prev ? { ...prev, draft } : prev))
        }
        onCommitRename={commitRename}
        onCancelRename={() => setRenaming(null)}
        onAskDelete={(entry) =>
          setDeletePrompt({ id: entry.id, name: entry.name })
        }
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3 text-sm">
        <button
          type="button"
          onClick={handleExport}
          className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[var(--panel)]"
        >
          Export presets
        </button>
        <button
          type="button"
          onClick={triggerImport}
          className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[var(--panel)]"
        >
          Import presets
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={onImportFileChosen}
        />
        {importStatus ? (
          <span className="text-xs text-[var(--muted)]">{importStatus}</span>
        ) : null}
        {importError ? (
          <span className="text-xs text-[var(--error)]">{importError}</span>
        ) : null}
      </div>

      {confirmLoadId !== null ? (
        <ConfirmDialog
          title="Replace your current configuration?"
          body="Loading this preset will replace your current configuration. Continue?"
          confirmLabel="Load"
          cancelLabel="Cancel"
          onConfirm={() => actuallyLoad(confirmLoadId)}
          onCancel={() => setConfirmLoadId(null)}
        />
      ) : null}

      {deletePrompt !== null ? (
        <ConfirmDialog
          title={`Delete preset "${deletePrompt.name}"?`}
          body="This cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setDeletePrompt(null)}
        />
      ) : null}

      {conflict !== null ? (
        <ConflictDialog
          existing={conflict.existing}
          incoming={conflict.incoming}
          onPick={(decision) => {
            const cb = conflict.resolve;
            setConflict(null);
            cb(decision);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner components
// ---------------------------------------------------------------------------

interface PresetListProps {
  entries: PresetIndexEntry[];
  renaming: RenameState | null;
  onLoad: (id: string) => void;
  onStartRename: (entry: PresetIndexEntry) => void;
  onRenameDraft: (draft: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onAskDelete: (entry: PresetIndexEntry) => void;
}

function PresetList(props: PresetListProps): React.JSX.Element {
  const {
    entries,
    renaming,
    onLoad,
    onStartRename,
    onRenameDraft,
    onCommitRename,
    onCancelRename,
    onAskDelete,
  } = props;
  const sorted = useMemo(() => entries, [entries]);
  if (sorted.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No presets yet. Save the current configuration to start a library.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {sorted.map((entry) => {
        const isRenaming = renaming !== null && renaming.id === entry.id;
        return (
          <li
            key={entry.id}
            className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-white p-3 sm:flex-row sm:items-center"
          >
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <input
                  type="text"
                  value={renaming.draft}
                  onChange={(e) => onRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCommitRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onCancelRename();
                    }
                  }}
                  autoFocus
                  className="w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm font-medium"
                />
              ) : (
                <p className="truncate font-medium text-[var(--heading)]">
                  {entry.name}
                </p>
              )}
              <p className="text-xs text-[var(--muted)]">
                {entry.difficultyDescriptor} · last printed{" "}
                {formatDate(entry.lastPrintedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isRenaming ? (
                <>
                  <button
                    type="button"
                    onClick={onCommitRename}
                    className="cursor-pointer rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={onCancelRename}
                    className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onLoad(entry.id)}
                    className="cursor-pointer rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartRename(entry)}
                    className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => onAskDelete(entry)}
                    className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--error)]"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element {
  const {
    title,
    body,
    confirmLabel,
    cancelLabel,
    destructive,
    onConfirm,
    onCancel,
  } = props;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-md bg-white p-5 shadow-lg">
        <h3 className="text-base font-semibold text-[var(--heading)]">
          {title}
        </h3>
        <p className="mt-2 text-sm text-[var(--foreground)]">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold text-white ${
              destructive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConflictDialogProps {
  existing: MazeHuntPreset;
  incoming: MazeHuntPreset;
  onPick: (decision: ImportConflictResolution) => void;
}

function ConflictDialog(props: ConflictDialogProps): React.JSX.Element {
  const { existing, incoming, onPick } = props;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Preset conflict"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
        <h3 className="text-base font-semibold text-[var(--heading)]">
          Preset conflict
        </h3>
        <p className="mt-2 text-sm text-[var(--foreground)]">
          A preset named <strong>{existing.name}</strong> already exists. The
          imported file has one with the same {existing.id === incoming.id ? "id" : "name"}.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onPick("rename")}
            className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-left hover:bg-[var(--panel)]"
          >
            Keep both — import as a renamed copy
          </button>
          <button
            type="button"
            onClick={() => onPick("replace")}
            className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-left hover:bg-[var(--panel)]"
          >
            Replace existing
          </button>
          <button
            type="button"
            onClick={() => onPick("skip")}
            className="cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-left hover:bg-[var(--panel)]"
          >
            Skip this one
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Convenience re-export so the caller can ask the parent to record a print
 * against a preset. (Parent owns the `currentPresetId` state.)
 */
export { recordPresetPrint };
