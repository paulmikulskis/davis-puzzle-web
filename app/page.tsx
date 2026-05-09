"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  CatalogBrowser,
  type CatalogBrowserHandle,
} from "@/app/CatalogBrowser";
import { PuzzleVisualizer } from "@/app/PuzzleVisualizer";
import { canonicalize, humanize, puzzleFilename } from "@/lib/canonicalize";
import { isPuzzleError, type PuzzleErrorCode } from "@/lib/errors";
import { fetchTexture } from "@/lib/fetchTexture";
import {
  DEFAULT_LABEL_OPTIONS,
  countPaletteCells,
  extractPaletteFromBlob,
  type LabelOptions,
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
  labelOptions: LabelOptions;
}

const DEFAULT_STATUS = "Type an item name and generate a printable 4-page PDF.";

export default function Home() {
  const [itemName, setItemName] = useState("apple");
  const [maxColors, setMaxColors] = useState(8);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [error, setError] = useState<{
    message: string;
    code?: PuzzleErrorCode;
  } | null>(null);
  const [puzzle, setPuzzle] = useState<GeneratedPuzzle | null>(null);
  const [labelOptions, setLabelOptions] = useState<LabelOptions>(
    DEFAULT_LABEL_OPTIONS,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRebuildingPdf, setIsRebuildingPdf] = useState(false);
  const generateButtonRef = useRef<HTMLButtonElement | null>(null);
  const catalogRef = useRef<CatalogBrowserHandle | null>(null);

  function handleCatalogPick(canonicalName: string, displayName: string) {
    setItemName(displayName);
    setError(null);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        generateButtonRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        generateButtonRef.current?.focus({ preventScroll: true });
      });
    }
  }

  useEffect(() => {
    return () => {
      if (puzzle) {
        URL.revokeObjectURL(puzzle.url);
        URL.revokeObjectURL(puzzle.textureUrl);
      }
    };
  }, [puzzle]);

  useEffect(() => {
    if (!puzzle) return;
    if (
      puzzle.labelOptions.columnsCase === labelOptions.columnsCase &&
      puzzle.labelOptions.rowsCase === labelOptions.rowsCase
    ) {
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setIsRebuildingPdf(true);
      try {
        const { buildPdf } = await import("@/lib/pdf");
        const pdfBytes = await buildPdf({
          itemLabel: puzzle.itemLabel,
          sourceFilename: puzzle.sourceFilename,
          palette: puzzle.palette,
          labelOptions,
        });
        if (cancelled) return;
        const buffer = new ArrayBuffer(pdfBytes.byteLength);
        new Uint8Array(buffer).set(pdfBytes);
        const blob = new Blob([buffer], { type: "application/pdf" });
        const nextUrl = URL.createObjectURL(blob);
        const previousUrl = puzzle.url;
        setPuzzle((current) =>
          current && current.id === puzzle.id
            ? { ...current, url: nextUrl, labelOptions }
            : current,
        );
        URL.revokeObjectURL(previousUrl);
      } catch {
        // Keep the previous PDF; the preview will still reflect the new labels.
      } finally {
        if (!cancelled) {
          setIsRebuildingPdf(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [labelOptions, puzzle]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const canonical = canonicalize(itemName);
    if (!canonical) {
      setError({
        message: "Type a Minecraft item name first.",
        code: "bad-input",
      });
      setStatus(DEFAULT_STATUS);
      return;
    }

    setPuzzle(null);
    setIsGenerating(true);
    setError(null);

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
        labelOptions,
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
        labelOptions,
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
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col gap-10">
        <div className="grid gap-8 pt-2 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-10">
          <div className="order-2 max-w-[34rem] lg:order-1">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
              Minecraft Pixel Puzzle
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-[var(--heading)] sm:text-4xl lg:text-[2.75rem]">
              Generate a printable pixel-art worksheet from any Minecraft item.
            </h1>
            <p className="mt-5 text-base leading-7 text-[var(--muted)]">
              Flat items work best: foods, tools, ingots, gems, mob drops,
              plants, and minerals usually make clearer puzzles than block
              icons.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="order-1 rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm lg:order-2"
          >
            <div className="space-y-4">
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
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-base outline-none transition hover:border-[var(--heading)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <label
                    htmlFor="max-colors"
                    className="block text-sm font-medium text-[var(--heading)]"
                  >
                    Max colors
                  </label>
                  <span className="tabular-nums text-sm font-semibold text-[var(--accent)]">
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
                ref={generateButtonRef}
                type="submit"
                disabled={isGenerating}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isGenerating ? (
                  <>
                    <span
                      className="davis-spinner"
                      aria-hidden="true"
                    />
                    <span>Generating…</span>
                  </>
                ) : (
                  "Generate"
                )}
              </button>
            </div>

            <div
              className="mt-4 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-sm leading-6"
              aria-live="polite"
            >
              <p className="font-medium text-[var(--heading)]">{status}</p>
              {error ? (
                <p className="mt-2 text-[var(--error)]">
                  {error.message}
                  {error.code === "not-found" || error.code === "decode" ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() => {
                          catalogRef.current?.openAndFocus(itemName.trim());
                        }}
                        className="cursor-pointer font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
                      >
                        Browse items
                      </button>
                      <span> below.</span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          </form>
        </div>

        <CatalogBrowser ref={catalogRef} onPick={handleCatalogPick} />

        <PuzzleVisualizer
          key={puzzle?.id ?? "empty-preview"}
          puzzle={puzzle}
          onConfirm={triggerDownload}
          labelOptions={labelOptions}
          onLabelOptionsChange={setLabelOptions}
          isRebuildingPdf={isRebuildingPdf}
        />

        <footer className="mt-auto border-t border-[var(--border)] pt-5 text-sm text-[var(--muted)]">
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

function friendlyError(error: unknown): {
  message: string;
  code?: PuzzleErrorCode;
} {
  if (isPuzzleError(error)) {
    if (error.code === "not-found") {
      return {
        code: "not-found",
        message:
          "Couldn't find that item. Check the spelling or browse the catalog.",
      };
    }
    if (error.code === "transparent") {
      return {
        code: "transparent",
        message: "This icon has no opaque pixels. Try a different item.",
      };
    }
    if (error.code === "network") {
      return {
        code: "network",
        message: "Couldn't reach the wiki. Try again in a moment.",
      };
    }
    if (error.code === "bad-input") {
      return { code: "bad-input", message: error.message };
    }
    return {
      code: "decode",
      message: "Couldn't decode that texture. Try a different item.",
    };
  }

  return {
    message:
      "Something went wrong while generating the worksheet. Try again in a moment.",
  };
}
