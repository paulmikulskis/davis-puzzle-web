"use client";

// Epic 1 scratch page. End-to-end maze-only PDF flow used to validate the
// generator + renderer + dynamic pdf-lib import path. Real Maze Hunt UI lives
// behind the tab strip in app/page.tsx (lands in Epic 4).

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  generateMaze,
  type CardinalPosition,
  type Silhouette,
} from "@/lib/maze";

type SilhouetteKind = "circle" | "star4" | "rectangle";
type Preset = "small" | "medium" | "large";

interface GeneratedMazePdf {
  id: string;
  url: string;
  filename: string;
  seed: string;
  silhouetteLabel: string;
  preset: Preset;
  cells: { across: number; down: number };
  walls: number;
  solutionLength: number;
}

function buildSilhouette(kind: SilhouetteKind, preset: Preset): Silhouette {
  if (kind === "rectangle") {
    const dims =
      preset === "small"
        ? { width: 12, height: 16 }
        : preset === "medium"
          ? { width: 16, height: 20 }
          : { width: 22, height: 27 };
    return { kind: "rectangle", width: dims.width, height: dims.height };
  }
  const diameter = preset === "small" ? 14 : preset === "medium" ? 18 : 22;
  if (kind === "circle") return { kind: "circle", diameter };
  return { kind: "star4", boundingBox: diameter };
}

function defaultEntranceFor(kind: SilhouetteKind): CardinalPosition {
  if (kind === "rectangle") return "S";
  if (kind === "circle") return "S";
  return "N";
}

function defaultExitFor(kind: SilhouetteKind): CardinalPosition {
  if (kind === "rectangle") return "N";
  if (kind === "circle") return "N";
  return "S";
}

export default function MazeScratchPage() {
  const [silhouette, setSilhouette] = useState<SilhouetteKind>("circle");
  const [preset, setPreset] = useState<Preset>("medium");
  const [showSolution, setShowSolution] = useState(false);
  const [bwSafe, setBwSafe] = useState(false);
  const [pdf, setPdf] = useState<GeneratedMazePdf | null>(null);
  const [status, setStatus] = useState(
    "Pick a silhouette and a size, then Generate.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const generateButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    return () => {
      if (pdf) URL.revokeObjectURL(pdf.url);
    };
  }, [pdf]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsGenerating(true);
    let nextUrl: string | null = null;
    let committed = false;
    try {
      setStatus("Generating maze...");
      const grid = generateMaze({
        silhouette: buildSilhouette(silhouette, preset),
        cellCountPreset: preset,
        entrance: defaultEntranceFor(silhouette),
        exit: defaultExitFor(silhouette),
      });

      setStatus("Rendering PDF...");
      const { buildMazeHuntPdf } = await import("@/lib/pdf/mazeHunt");
      const themeLabel =
        silhouette === "circle"
          ? "End Island (test)"
          : silhouette === "star4"
            ? "Nether (test)"
            : "Ocean Monument (test)";
      const pdfBytes = await buildMazeHuntPdf({
        grid,
        title: themeLabel,
        themeLabel,
        showSolutionPath: showSolution,
        blackAndWhiteSafe: bwSafe,
      });
      const buffer = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(buffer).set(pdfBytes);
      const blob = new Blob([buffer], { type: "application/pdf" });
      nextUrl = URL.createObjectURL(blob);
      const filename = `maze_${silhouette}_${preset}_${grid.seed}.pdf`;
      setPdf({
        id: `${grid.seed}-${Date.now()}`,
        url: nextUrl,
        filename,
        seed: grid.seed,
        silhouetteLabel: themeLabel,
        preset,
        cells: { across: grid.cellsAcross, down: grid.cellsDown },
        walls: grid.walls.length,
        solutionLength: grid.solutionPath.length,
      });
      committed = true;
      setStatus(
        `Preview ready — ${grid.walls.length} walls, solution path ${grid.solutionPath.length} cells. Confirm to download.`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong rendering the maze.";
      setError(msg);
      setStatus("Could not generate the maze.");
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
            Maze Hunt — Epic 1 scratch
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-[var(--heading)]">
            Procedural maze worksheet (foundation)
          </h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Generates a single Letter PDF with a perfect maze on the chosen
            silhouette. Used to verify the generator + pdf-lib spike before the
            full Maze Hunt UI lands in Epic 4.
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm"
        >
          <div className="space-y-5">
            <div>
              <label
                htmlFor="silhouette"
                className="block text-sm font-medium text-[var(--heading)]"
              >
                Silhouette
              </label>
              <select
                id="silhouette"
                value={silhouette}
                onChange={(e) =>
                  setSilhouette(e.target.value as SilhouetteKind)
                }
                disabled={isGenerating}
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base"
              >
                <option value="circle">Circle (End Island)</option>
                <option value="star4">Star (Nether)</option>
                <option value="rectangle">Rectangle (Ocean Monument)</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="preset"
                className="block text-sm font-medium text-[var(--heading)]"
              >
                Size preset
              </label>
              <select
                id="preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
                disabled={isGenerating}
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showSolution}
                  onChange={(e) => setShowSolution(e.target.checked)}
                  disabled={isGenerating}
                />
                <span>Show answer key path</span>
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
            </div>
            <button
              ref={generateButtonRef}
              type="submit"
              disabled={isGenerating}
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
              <dt className="font-medium">Silhouette</dt>
              <dd>{pdf.silhouetteLabel}</dd>
              <dt className="font-medium">Preset</dt>
              <dd>{pdf.preset}</dd>
              <dt className="font-medium">Cells</dt>
              <dd>
                {pdf.cells.across} × {pdf.cells.down}
              </dd>
              <dt className="font-medium">Walls</dt>
              <dd>{pdf.walls}</dd>
              <dt className="font-medium">Solution length</dt>
              <dd>{pdf.solutionLength} cells</dd>
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
