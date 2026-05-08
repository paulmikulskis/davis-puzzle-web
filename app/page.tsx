"use client";

import { FormEvent, useEffect, useState } from "react";
import { PuzzleVisualizer } from "@/app/PuzzleVisualizer";
import { canonicalize, humanize, puzzleFilename } from "@/lib/canonicalize";
import { isPuzzleError } from "@/lib/errors";
import { fetchTexture } from "@/lib/fetchTexture";
import {
  countPaletteCells,
  extractPaletteFromBlob,
  type PaletteEntry,
} from "@/lib/palette";

export interface GeneratedPuzzle {
  id: string;
  url: string;
  filename: string;
  itemLabel: string;
  sourceFilename: string;
  colorCount: number;
  opaqueCellCount: number;
  textureUrl: string;
  palette: PaletteEntry[];
  imageData: ImageData;
}

const DEFAULT_STATUS = "Type an item name and generate a printable 4-page PDF.";

export default function Home() {
  const [itemName, setItemName] = useState("apple");
  const [maxColors, setMaxColors] = useState(8);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [error, setError] = useState("");
  const [puzzle, setPuzzle] = useState<GeneratedPuzzle | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    return () => {
      if (puzzle) {
        URL.revokeObjectURL(puzzle.url);
        URL.revokeObjectURL(puzzle.textureUrl);
      }
    };
  }, [puzzle]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const canonical = canonicalize(itemName);
    if (!canonical) {
      setError("Type a Minecraft item name first.");
      setStatus(DEFAULT_STATUS);
      return;
    }

    setPuzzle(null);
    setIsGenerating(true);
    setError("");

    let textureUrl: string | null = null;
    let pdfUrl: string | null = null;
    let committed = false;

    try {
      setStatus("Fetching texture...");
      const texture = await fetchTexture(canonical);
      textureUrl = texture.blobUrl;

      setStatus("Extracting palette...");
      const { palette, opaqueCellCount, imageData } = await extractPaletteFromBlob(
        texture.blob,
        maxColors,
      );

      setStatus("Rendering PDF...");
      const { buildPdf } = await import("@/lib/pdf");
      const itemLabel = humanize(texture.canonical);
      const pdfBytes = await buildPdf({
        itemLabel,
        sourceFilename: texture.sourceFilename,
        palette,
      });
      const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(pdfBuffer).set(pdfBytes);
      const pdfBlob = new Blob([pdfBuffer], { type: "application/pdf" });
      pdfUrl = URL.createObjectURL(pdfBlob);
      const filename = puzzleFilename(texture.canonical);
      const cellCount = countPaletteCells(palette);

      setPuzzle({
        id: `${texture.canonical}-${Date.now()}`,
        url: pdfUrl,
        filename,
        itemLabel,
        sourceFilename: texture.sourceFilename,
        colorCount: palette.length,
        opaqueCellCount: cellCount,
        textureUrl,
        palette,
        imageData,
      });
      committed = true;
      setStatus(
        `Preview ready - generated a 4-page PDF with ${opaqueCellCount} opaque cells across ${palette.length} colors. Confirm below to download.`,
      );
    } catch (caught) {
      setError(friendlyError(caught));
      setStatus("Could not generate the puzzle yet.");
    } finally {
      if (!committed) {
        if (textureUrl) {
          URL.revokeObjectURL(textureUrl);
        }
        if (pdfUrl) {
          URL.revokeObjectURL(pdfUrl);
        }
      }
      setIsGenerating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--foreground)] sm:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col justify-between gap-8">
        <div className="grid gap-8 pt-4 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
              Minecraft Pixel Puzzle
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight text-[var(--heading)] sm:text-5xl">
              Generate a printable pixel-art worksheet from any Minecraft item.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)]">
              Flat items work best: foods, tools, ingots, gems, mob drops,
              plants, and minerals usually make clearer puzzles than block
              icons.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm"
          >
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="item-name"
                  className="block text-sm font-medium text-[var(--heading)]"
                >
                  Minecraft item
                </label>
                <input
                  id="item-name"
                  name="item-name"
                  type="text"
                  value={itemName}
                  onChange={(event) => setItemName(event.target.value)}
                  disabled={isGenerating}
                  placeholder="cooked salmon"
                  className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-4">
                  <label
                    htmlFor="max-colors"
                    className="block text-sm font-medium text-[var(--heading)]"
                  >
                    Max colors
                  </label>
                  <span className="min-w-8 text-right text-sm font-semibold text-[var(--accent)]">
                    {maxColors}
                  </span>
                </div>
                <input
                  id="max-colors"
                  name="max-colors"
                  type="range"
                  min="4"
                  max="12"
                  step="1"
                  value={maxColors}
                  onChange={(event) => setMaxColors(Number(event.target.value))}
                  disabled={isGenerating}
                  className="mt-3 w-full accent-[var(--accent)] disabled:cursor-not-allowed"
                />
              </div>

              <button
                type="submit"
                disabled={isGenerating}
                className="w-full rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isGenerating ? "Generating..." : "Generate"}
              </button>
            </div>

            <div
              className="mt-5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-sm leading-6"
              aria-live="polite"
            >
              <p className="font-medium text-[var(--heading)]">{status}</p>
              {error ? (
                <p className="mt-2 text-[var(--error)]">{error}</p>
              ) : null}
            </div>
          </form>
        </div>

        <PuzzleVisualizer
          key={puzzle?.id ?? "empty-preview"}
          puzzle={puzzle}
          onConfirm={triggerDownload}
        />

        <footer className="border-t border-[var(--border)] pt-5 text-sm text-[var(--muted)]">
          Unofficial fan-made tool. Textures &copy; Mojang, sourced from
          minecraft.wiki.
        </footer>
      </section>
    </main>
  );
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function friendlyError(error: unknown): string {
  if (isPuzzleError(error)) {
    if (error.code === "not-found") {
      return "Couldn't find that item. Check the spelling or try a different Minecraft item.";
    }
    if (error.code === "transparent") {
      return "This icon has no opaque pixels. Try a different item.";
    }
    if (error.code === "network") {
      return "Couldn't reach the wiki. Try again in a moment.";
    }
    if (error.code === "bad-input") {
      return error.message;
    }
    return "Couldn't decode that texture. Try a different item.";
  }

  return "Something went wrong while generating the worksheet. Try again in a moment.";
}
