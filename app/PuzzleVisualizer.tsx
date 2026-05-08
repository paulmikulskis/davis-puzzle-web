"use client";

import { useMemo, useState } from "react";
import { type GeneratedPuzzle } from "@/app/page";
import {
  COLUMNS,
  GRID_N,
  ROWS,
  cellLabel,
  type PaletteEntry,
  type RGB,
} from "@/lib/palette";

interface PuzzleVisualizerProps {
  puzzle: GeneratedPuzzle | null;
  onConfirm: (url: string, filename: string) => void;
}

const slides = [
  "Summary",
  "Answer key",
  "Coordinate coloring",
  "Color by number",
];

export function PuzzleVisualizer({
  puzzle,
  onConfirm,
}: PuzzleVisualizerProps) {
  const [activeSlide, setActiveSlide] = useState(0);

  if (!puzzle) {
    return (
      <section className="rounded-lg border border-dashed border-[var(--border)] bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
          Preview
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--heading)]">
          Generate a puzzle to review the deliverables.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          The finished worksheet preview will appear here before anything
          downloads. You can step through the summary, answer key, advanced
          coordinate sheet, and simplified numbered sheet, then confirm the PDF.
        </p>
      </section>
    );
  }

  const goPrevious = () =>
    setActiveSlide((current) => (current === 0 ? slides.length - 1 : current - 1));
  const goNext = () =>
    setActiveSlide((current) => (current === slides.length - 1 ? 0 : current + 1));

  return (
    <section className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
            Generated Preview
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-[var(--heading)]">
            {puzzle.itemLabel} worksheet set
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {puzzle.opaqueCellCount} filled cells, {puzzle.colorCount} colors,
            source {puzzle.sourceFilename}.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onConfirm(puzzle.url, puzzle.filename)}
          className="rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] focus:ring-offset-2"
        >
          Confirm download
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {slides.map((slide, index) => (
            <button
              key={slide}
              type="button"
              onClick={() => setActiveSlide(index)}
              aria-pressed={activeSlide === index}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                activeSlide === index
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-[var(--border)] bg-white text-[var(--foreground)] hover:border-[var(--accent)]"
              }`}
            >
              {index + 1}. {slide}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={goPrevious}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--heading)] transition hover:border-[var(--accent)]"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--heading)] transition hover:border-[var(--accent)]"
          >
            Next
          </button>
        </div>
      </div>

      <div className="mt-5 min-h-[420px]">
        {activeSlide === 0 ? <SummarySlide puzzle={puzzle} /> : null}
        {activeSlide === 1 ? <AnswerKeySlide puzzle={puzzle} /> : null}
        {activeSlide === 2 ? <CoordinateSlide puzzle={puzzle} /> : null}
        {activeSlide === 3 ? <NumberedSlide puzzle={puzzle} /> : null}
      </div>
    </section>
  );
}

function SummarySlide({ puzzle }: { puzzle: GeneratedPuzzle }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="grid gap-4 sm:grid-cols-2">
        <PreviewPanel title="Minecraft image">
          <div className="mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel)] p-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={puzzle.textureUrl}
              alt={`${puzzle.itemLabel} inventory texture`}
              className="h-full w-full object-contain [image-rendering:pixelated]"
            />
          </div>
        </PreviewPanel>

        <PreviewPanel title="16x16 color map">
          <PixelGrid
            palette={puzzle.palette}
            mode="color"
            className="mx-auto max-w-[220px]"
          />
        </PreviewPanel>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <h3 className="text-lg font-semibold text-[var(--heading)]">
          Produced deliverables
        </h3>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--foreground)]">
          <li>
            <strong>Facilitator key and legend:</strong> a completed color
            reference with coordinate lists for each swatch.
          </li>
          <li>
            <strong>Advanced coordinate version:</strong> an alphabetic X/Y grid
            with the full coordinate-coloring key.
          </li>
          <li>
            <strong>Simplified numbered version:</strong> a color-by-number grid
            with the numbered color key.
          </li>
        </ul>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <MiniDeliverable title="Key">
            <PixelGrid palette={puzzle.palette} mode="color" compact />
          </MiniDeliverable>
          <MiniDeliverable title="Advanced">
            <PixelGrid palette={puzzle.palette} mode="blank" compact />
          </MiniDeliverable>
          <MiniDeliverable title="Numbered">
            <PixelGrid palette={puzzle.palette} mode="number" compact />
          </MiniDeliverable>
        </div>
      </div>
    </div>
  );
}

function AnswerKeySlide({ puzzle }: { puzzle: GeneratedPuzzle }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <PreviewPanel title="Facilitator answer key">
        <PixelGrid palette={puzzle.palette} mode="color" withAxes />
      </PreviewPanel>
      <PaletteLegend palette={puzzle.palette} mode="coordinates" />
    </div>
  );
}

function CoordinateSlide({ puzzle }: { puzzle: GeneratedPuzzle }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <PreviewPanel title="Advanced coordinate-coloring worksheet">
        <PixelGrid palette={puzzle.palette} mode="blank" withAxes />
      </PreviewPanel>
      <PaletteLegend palette={puzzle.palette} mode="coordinates" />
    </div>
  );
}

function NumberedSlide({ puzzle }: { puzzle: GeneratedPuzzle }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <PreviewPanel title="Simplified color-by-number worksheet">
        <PixelGrid palette={puzzle.palette} mode="number" withAxes />
      </PreviewPanel>
      <PaletteLegend palette={puzzle.palette} mode="numbers" />
    </div>
  );
}

function PreviewPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function MiniDeliverable({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-2">
      <div className="mb-2 text-center text-xs font-semibold text-[var(--muted)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function PixelGrid({
  palette,
  mode,
  withAxes = false,
  compact = false,
  className = "",
}: {
  palette: PaletteEntry[];
  mode: "color" | "blank" | "number";
  withAxes?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const cellMap = useMemo(() => buildCellMap(palette), [palette]);
  const numberMap = useMemo(() => buildNumberMap(palette), [palette]);
  const cells = Array.from({ length: GRID_N * GRID_N }, (_, index) => {
    const x = index % GRID_N;
    const y = Math.floor(index / GRID_N);
    const label = cellLabel(x, y);
    return { x, y, label, rgb: cellMap.get(label), number: numberMap.get(label) };
  });

  if (withAxes) {
    return (
      <div className={`mx-auto w-full max-w-[560px] ${className}`}>
        <div
          className="grid rounded-md border border-[var(--border)] bg-white p-2"
          style={{
            gridTemplateColumns: `24px repeat(${GRID_N}, minmax(0, 1fr))`,
          }}
        >
          <AxisCell />
          {COLUMNS.split("").map((column) => (
            <AxisCell key={column}>{column}</AxisCell>
          ))}
          {ROWS.split("").map((row, y) => (
            <FragmentRow key={row} row={row} y={y} cells={cells} mode={mode} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`grid overflow-hidden rounded-md border border-[var(--border)] bg-white ${className}`}
      style={{ gridTemplateColumns: `repeat(${GRID_N}, minmax(0, 1fr))` }}
    >
      {cells.map((gridCell) => (
        <PreviewCell
          key={gridCell.label}
          rgb={gridCell.rgb}
          number={gridCell.number}
          mode={mode}
          compact={compact}
        />
      ))}
    </div>
  );
}

function FragmentRow({
  row,
  y,
  cells,
  mode,
}: {
  row: string;
  y: number;
  cells: Array<{
    x: number;
    y: number;
    label: string;
    rgb?: RGB;
    number?: number;
  }>;
  mode: "color" | "blank" | "number";
}) {
  const rowCells = cells.filter((cell) => cell.y === y);
  return (
    <>
      <AxisCell>{row}</AxisCell>
      {rowCells.map((gridCell) => (
        <PreviewCell
          key={gridCell.label}
          rgb={gridCell.rgb}
          number={gridCell.number}
          mode={mode}
        />
      ))}
    </>
  );
}

function AxisCell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex aspect-square items-center justify-center text-[10px] font-semibold text-[var(--muted)]">
      {children}
    </div>
  );
}

function PreviewCell({
  rgb,
  number,
  mode,
  compact = false,
}: {
  rgb?: RGB;
  number?: number;
  mode: "color" | "blank" | "number";
  compact?: boolean;
}) {
  const filled = Boolean(rgb);
  const background =
    mode === "color" && rgb ? rgbToCss(rgb) : filled ? "#ffffff" : "#f3f5f7";

  return (
    <div
      className={`flex aspect-square items-center justify-center border border-[#dfe4ea] ${
        compact ? "text-[6px]" : "text-[10px] sm:text-xs"
      } font-semibold text-[var(--heading)]`}
      style={{ backgroundColor: background }}
    >
      {mode === "number" && number ? number : null}
    </div>
  );
}

function PaletteLegend({
  palette,
  mode,
}: {
  palette: PaletteEntry[];
  mode: "coordinates" | "numbers";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {mode === "numbers" ? "Color key" : "Coordinate key"}
      </h3>
      <div className="mt-3 space-y-3">
        {palette.map((entry, index) => (
          <div key={`${entry.rgb.join("-")}-${index}`} className="flex gap-3">
            <div
              className="mt-0.5 h-6 w-6 shrink-0 rounded-sm border border-black/40"
              style={{ backgroundColor: rgbToCss(entry.rgb) }}
            />
            <div className="min-w-0 text-sm leading-5">
              <div className="font-semibold text-[var(--heading)]">
                {mode === "numbers" ? `Color ${index + 1}` : `Swatch ${index + 1}`}
                <span className="ml-2 font-normal text-[var(--muted)]">
                  {entry.cells.length} cells
                </span>
              </div>
              {mode === "coordinates" ? (
                <p className="mt-1 break-words text-xs text-[var(--muted)]">
                  {entry.cells.join(", ")}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildCellMap(palette: PaletteEntry[]): Map<string, RGB> {
  const map = new Map<string, RGB>();
  for (const entry of palette) {
    for (const cell of entry.cells) {
      map.set(cell, entry.rgb);
    }
  }
  return map;
}

function buildNumberMap(palette: PaletteEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  palette.forEach((entry, index) => {
    for (const cell of entry.cells) {
      map.set(cell, index + 1);
    }
  });
  return map;
}

function rgbToCss(rgb: RGB): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}
