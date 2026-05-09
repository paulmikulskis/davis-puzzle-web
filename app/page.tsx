"use client";

// Top-level page hosts a tab strip with two products at equal weight:
// Pixel Puzzle (existing) and Maze Hunt (new). The user's last-picked tab
// persists in localStorage so returning visitors land on whatever they were
// using last. First-time visitors land on Pixel Puzzle by default.
//
// Inside Maze Hunt, the tab body shows either the activity selector
// (theme card grid) or the editor itself, depending on whether the user
// has clicked into a theme.

import { useEffect, useState } from "react";
import { PixelPuzzlePanel } from "@/app/PixelPuzzlePanel";
import { MazeHuntActivitySelector } from "@/app/MazeHuntActivitySelector";
import { MazeHuntPanel } from "@/app/MazeHuntPanel";
import type { DifficultyPreset } from "@/lib/mazeHuntThemes";

type ActiveTab = "pixel-puzzle" | "maze-hunt";
type MazeHuntView = "selector" | "editor";

const ACTIVE_TAB_KEY = "davis.activeTab";

interface MazeHuntPick {
  themeId: string;
  difficulty: DifficultyPreset;
}

export default function Home() {
  // First render uses the SSR-safe default. On mount we hydrate from
  // localStorage and update via a synchronous useLayoutEffect so the
  // mismatch is fixed before paint. The eslint rule that flags setState in
  // an effect doesn't apply here — this is the documented React pattern for
  // syncing client-only state into server-rendered components.
  const [activeTab, setActiveTab] = useState<ActiveTab>("pixel-puzzle");
  const [mazeHuntView, setMazeHuntView] = useState<MazeHuntView>("selector");
  const [mazeHuntPick, setMazeHuntPick] = useState<MazeHuntPick | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(ACTIVE_TAB_KEY);
    if (raw === "pixel-puzzle" || raw === "maze-hunt") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(raw);
    }
  }, []);

  function changeTab(next: ActiveTab): void {
    setActiveTab(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_TAB_KEY, next);
    }
  }

  function openMazeHuntEditor(
    themeId: string,
    difficulty: DifficultyPreset,
  ): void {
    setMazeHuntPick({ themeId, difficulty });
    setMazeHuntView("editor");
  }

  function backToSelector(): void {
    setMazeHuntView("selector");
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-6 text-[var(--foreground)] sm:px-8">
      <nav
        aria-label="Activity tabs"
        className="mx-auto mb-8 flex w-full max-w-6xl gap-2 border-b border-[var(--border)]"
      >
        <button
          type="button"
          onClick={() => changeTab("pixel-puzzle")}
          className={`min-h-[44px] cursor-pointer px-5 py-3 text-sm font-semibold transition ${
            activeTab === "pixel-puzzle"
              ? "border-b-2 border-[var(--accent)] text-[var(--heading)]"
              : "border-b-2 border-transparent text-[var(--muted)] hover:text-[var(--heading)]"
          }`}
          aria-pressed={activeTab === "pixel-puzzle"}
        >
          Pixel Puzzle
        </button>
        <button
          type="button"
          onClick={() => changeTab("maze-hunt")}
          className={`min-h-[44px] cursor-pointer px-5 py-3 text-sm font-semibold transition ${
            activeTab === "maze-hunt"
              ? "border-b-2 border-[var(--accent)] text-[var(--heading)]"
              : "border-b-2 border-transparent text-[var(--muted)] hover:text-[var(--heading)]"
          }`}
          aria-pressed={activeTab === "maze-hunt"}
        >
          Maze Hunt
        </button>
      </nav>

      {activeTab === "pixel-puzzle" ? <PixelPuzzlePanel /> : null}

      {activeTab === "maze-hunt" && mazeHuntView === "selector" ? (
        <MazeHuntActivitySelector onOpenEditor={openMazeHuntEditor} />
      ) : null}

      {activeTab === "maze-hunt" && mazeHuntView === "editor" ? (
        <MazeHuntPanel
          initialThemeId={mazeHuntPick?.themeId}
          initialDifficulty={mazeHuntPick?.difficulty}
          onBackToSelector={backToSelector}
        />
      ) : null}
    </main>
  );
}
