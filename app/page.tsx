"use client";

import { FormEvent, useEffect, useState } from "react";
import { canonicalize, humanize, puzzleFilename } from "@/lib/canonicalize";
import { isPuzzleError } from "@/lib/errors";
import { fetchTexture } from "@/lib/fetchTexture";
import { countPaletteCells, extractPaletteFromBlob } from "@/lib/palette";

interface DownloadState {
  url: string;
  filename: string;
  itemLabel: string;
  sourceFilename: string;
  colorCount: number;
  opaqueCellCount: number;
}

const DEFAULT_STATUS = "Type an item name and generate a printable 4-page PDF.";

export default function Home() {
  const [itemName, setItemName] = useState("apple");
  const [maxColors, setMaxColors] = useState(8);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [error, setError] = useState("");
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    return () => {
      if (download) {
        URL.revokeObjectURL(download.url);
      }
    };
  }, [download]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const canonical = canonicalize(itemName);
    if (!canonical) {
      setError("Type a Minecraft item name first.");
      setStatus(DEFAULT_STATUS);
      return;
    }

    if (download) {
      URL.revokeObjectURL(download.url);
      setDownload(null);
    }

    let textureUrlToRevoke: string | null = null;
    setIsGenerating(true);
    setError("");

    try {
      setStatus("Fetching texture...");
      const texture = await fetchTexture(canonical);
      textureUrlToRevoke = texture.blobUrl;

      setStatus("Extracting palette...");
      const { palette, opaqueCellCount } = await extractPaletteFromBlob(
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
      const url = URL.createObjectURL(pdfBlob);
      const filename = puzzleFilename(texture.canonical);
      const cellCount = countPaletteCells(palette);

      setDownload({
        url,
        filename,
        itemLabel,
        sourceFilename: texture.sourceFilename,
        colorCount: palette.length,
        opaqueCellCount: cellCount,
      });
      triggerDownload(url, filename);
      setStatus(
        `Done - generated a 4-page PDF with ${opaqueCellCount} opaque cells across ${palette.length} colors.`,
      );
    } catch (caught) {
      setError(friendlyError(caught));
      setStatus("Could not generate the puzzle yet.");
    } finally {
      if (textureUrlToRevoke) {
        URL.revokeObjectURL(textureUrlToRevoke);
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
              {download ? (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <a
                    href={download.url}
                    download={download.filename}
                    className="font-semibold text-[var(--accent)] underline decoration-2 underline-offset-4"
                  >
                    Download {download.filename}
                  </a>
                  <p className="mt-2 text-[var(--muted)]">
                    {download.itemLabel}: {download.opaqueCellCount} filled
                    cells, {download.colorCount} colors, source{" "}
                    {download.sourceFilename}.
                  </p>
                </div>
              ) : null}
            </div>
          </form>
        </div>

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
