"use client";

// Maze Hunt activity selector — front door for the Maze Hunt product.
// Three theme cards (End Island, Nether, Ocean Monument), each with a
// 3-pill difficulty selector and an "Open editor" CTA. Last-pick lives
// in localStorage at `davis.maze-hunt.last-pick`.
//
// R6 (per plan.md §10): every difficulty pill must present a 44px tap
// target so a Chromebook touch user lands the right pill on the first try.
// R1: each card renders with a pre-selected default difficulty so "Open
// editor" is actionable from the moment the card loads.

import { useEffect, useMemo, useState } from "react";
import {
  loadMazeHuntThemes,
  type DifficultyPreset,
  type MazeHuntTheme,
} from "@/lib/mazeHuntThemes";

const DIFFICULTY_OPTIONS: DifficultyPreset[] = ["easy", "medium", "hard"];
const DIFFICULTY_LABELS: Record<DifficultyPreset, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};
const LAST_PICK_KEY = "davis.maze-hunt.last-pick";

interface LastPick {
  themeId: string;
  difficulty: DifficultyPreset;
  timestamp: string;
}

function readLastPick(): LastPick | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LAST_PICK_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "themeId" in parsed &&
      "difficulty" in parsed &&
      "timestamp" in parsed
    ) {
      const candidate = parsed as Record<string, unknown>;
      if (
        typeof candidate.themeId === "string" &&
        typeof candidate.difficulty === "string" &&
        DIFFICULTY_OPTIONS.includes(candidate.difficulty as DifficultyPreset) &&
        typeof candidate.timestamp === "string"
      ) {
        return {
          themeId: candidate.themeId,
          difficulty: candidate.difficulty as DifficultyPreset,
          timestamp: candidate.timestamp,
        };
      }
    }
  } catch {
    // ignore malformed JSON
  }
  return null;
}

function writeLastPick(pick: LastPick): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_PICK_KEY, JSON.stringify(pick));
}

function relativeTime(timestamp: string): string {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return "earlier";
  const ms = Date.now() - t;
  const days = Math.floor(ms / 86400000);
  if (days <= 0) {
    const hrs = Math.floor(ms / 3600000);
    if (hrs <= 0) return "just now";
    return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  }
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export interface MazeHuntActivitySelectorProps {
  onOpenEditor: (themeId: string, difficulty: DifficultyPreset) => void;
}

export function MazeHuntActivitySelector({
  onOpenEditor,
}: MazeHuntActivitySelectorProps) {
  const [themes, setThemes] = useState<MazeHuntTheme[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pillByTheme, setPillByTheme] = useState<
    Record<string, DifficultyPreset>
  >({});
  const [lastPick, setLastPick] = useState<LastPick | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMazeHuntThemes()
      .then((data) => {
        if (cancelled) return;
        setThemes(data);
        const initial: Record<string, DifficultyPreset> = {};
        for (const t of data) initial[t.id] = t.defaultDifficulty;
        setPillByTheme(initial);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load themes.",
        );
      });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastPick(readLastPick());
    return () => {
      cancelled = true;
    };
  }, []);

  const lastPickedTheme = useMemo(
    () =>
      lastPick !== null
        ? themes.find((t) => t.id === lastPick.themeId) ?? null
        : null,
    [themes, lastPick],
  );

  function handleOpenEditor(themeId: string): void {
    const difficulty = pillByTheme[themeId];
    if (!difficulty) return;
    const pick: LastPick = {
      themeId,
      difficulty,
      timestamp: new Date().toISOString(),
    };
    writeLastPick(pick);
    setLastPick(pick);
    onOpenEditor(themeId, difficulty);
  }

  function handleResume(): void {
    if (!lastPick) return;
    onOpenEditor(lastPick.themeId, lastPick.difficulty);
  }

  function setPillFor(themeId: string, difficulty: DifficultyPreset): void {
    setPillByTheme((prev) => ({ ...prev, [themeId]: difficulty }));
  }

  if (loadError) {
    return (
      <section className="mx-auto w-full max-w-3xl">
        <div className="rounded-lg border border-[var(--border)] bg-white p-5 text-sm text-[var(--error)]">
          Couldn&apos;t load Maze Hunt themes: {loadError}
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
          Maze Hunt
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight text-[var(--heading)] sm:text-4xl">
          Pick a biome, pick a difficulty, open the editor.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Each theme prefills the editor with a coherent default — silhouette,
          collectibles, boss, assembly, and objective phrasing. Open the editor
          to re-roll the maze, override a line, or split the answer key onto a
          second page.
        </p>
      </div>

      {lastPickedTheme !== null && lastPick !== null ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm">
          <span className="text-[var(--muted)]">Last used: </span>
          <span className="font-medium text-[var(--heading)]">
            {lastPickedTheme.displayName} — {DIFFICULTY_LABELS[lastPick.difficulty]}
          </span>
          <span className="text-[var(--muted)]"> · {relativeTime(lastPick.timestamp)}</span>
          <button
            type="button"
            onClick={handleResume}
            className="ml-3 cursor-pointer font-semibold text-[var(--accent)] hover:underline"
          >
            Resume editor →
          </button>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {themes.map((theme) => {
          const selectedPill = pillByTheme[theme.id] ?? theme.defaultDifficulty;
          return (
            <article
              key={theme.id}
              className="flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition hover:shadow"
              style={{ borderColor: theme.accentColor }}
            >
              <div
                className="aspect-square w-full"
                style={{ backgroundColor: theme.accentColor }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={theme.thumbnailPath}
                  alt={`${theme.displayName} thumbnail`}
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="flex flex-col gap-3 p-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--heading)]">
                    {theme.displayName}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {theme.shortDescription}
                  </p>
                </div>
                <div
                  className="flex gap-2"
                  role="radiogroup"
                  aria-label={`${theme.displayName} difficulty`}
                >
                  {DIFFICULTY_OPTIONS.map((option) => {
                    const isSelected = selectedPill === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setPillFor(theme.id, option)}
                        className={`min-h-[44px] flex-1 rounded-md border px-3 text-sm font-medium transition ${
                          isSelected
                            ? "border-transparent bg-[var(--accent)] text-white"
                            : "border-[var(--border)] bg-white text-[var(--foreground)] hover:border-[var(--heading)]"
                        }`}
                      >
                        {DIFFICULTY_LABELS[option]}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenEditor(theme.id)}
                  className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]"
                >
                  Open editor →
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
