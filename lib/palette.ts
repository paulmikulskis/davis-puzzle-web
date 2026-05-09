import { PuzzleError } from "@/lib/errors";

export const GRID_N = 16;
export const COLUMNS = "ABCDEFGHIJKLMNOP";
export const ROWS = "abcdefghijklmnop";
export const ALPHA_THRESHOLD = 32;

export type RGB = [number, number, number];

export type AxisCase = "upper" | "lower";

export interface LabelOptions {
  columnsCase: AxisCase;
  rowsCase: AxisCase;
}

export const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  columnsCase: "upper",
  rowsCase: "lower",
};

export interface PaletteEntry {
  rgb: RGB;
  cells: string[];
}

export interface PaletteExtraction {
  palette: PaletteEntry[];
  opaqueCellCount: number;
  uniqueColorCount: number;
  imageData: ImageData;
}

interface OpaquePixel {
  rgb: RGB;
  label: string;
  index: number;
}

interface Bucket {
  indices: number[];
  order: number;
}

export async function extractPaletteFromBlob(
  blob: Blob,
  maxColors: number,
): Promise<PaletteExtraction> {
  const imageData = await decodeTextureToImageData(blob);
  const extracted = extractPaletteFromImageData(imageData, maxColors);
  return { ...extracted, imageData };
}

export async function decodeTextureToImageData(blob: Blob): Promise<ImageData> {
  if (typeof document === "undefined") {
    throw new PuzzleError("decode", "Texture decoding needs a browser canvas.");
  }

  const source = await loadImageSource(blob);
  const canvas = document.createElement("canvas");
  canvas.width = GRID_N;
  canvas.height = GRID_N;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    closeImageSource(source);
    throw new PuzzleError("decode", "Could not create a browser canvas.");
  }

  try {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, GRID_N, GRID_N);
    ctx.drawImage(source, 0, 0, GRID_N, GRID_N);
    return ctx.getImageData(0, 0, GRID_N, GRID_N);
  } catch (error) {
    throw new PuzzleError("decode", "Could not decode that texture image.", error);
  } finally {
    closeImageSource(source);
  }
}

export function extractPaletteFromImageData(
  imageData: ImageData,
  maxColors: number,
): Omit<PaletteExtraction, "imageData"> {
  if (imageData.width !== GRID_N || imageData.height !== GRID_N) {
    throw new PuzzleError("decode", `Expected a 16x16 texture, got ${imageData.width}x${imageData.height}.`);
  }

  const limit = Math.max(1, Math.floor(maxColors));
  const opaque: OpaquePixel[] = [];
  const unique = new Set<string>();
  const data = imageData.data;

  for (let y = 0; y < GRID_N; y += 1) {
    for (let x = 0; x < GRID_N; x += 1) {
      const offset = (y * GRID_N + x) * 4;
      const alpha = data[offset + 3];

      if (alpha >= ALPHA_THRESHOLD) {
        const rgb: RGB = [data[offset], data[offset + 1], data[offset + 2]];
        opaque.push({ rgb, label: cellLabel(x, y), index: opaque.length });
        unique.add(rgbKey(rgb));
      }
    }
  }

  if (opaque.length === 0) {
    throw new PuzzleError(
      "transparent",
      "This icon has no opaque pixels, try a different item.",
    );
  }

  const palette =
    unique.size <= limit
      ? exactPalette(opaque)
      : quantizedPalette(opaque, Math.min(unique.size, limit));

  return {
    palette,
    opaqueCellCount: opaque.length,
    uniqueColorCount: unique.size,
  };
}

export function cellLabel(x: number, y: number): string {
  return COLUMNS[x] + ROWS[y];
}

export function cellLabelToPoint(label: string): { x: number; y: number } {
  return {
    x: COLUMNS.indexOf(label[0]),
    y: ROWS.indexOf(label[1]),
  };
}

export function compareCellLabels(a: string, b: string): number {
  return ROWS.indexOf(a[1]) - ROWS.indexOf(b[1]) || COLUMNS.indexOf(a[0]) - COLUMNS.indexOf(b[0]);
}

export function displayColumn(index: number, options: LabelOptions): string {
  const ch = COLUMNS[index];
  return options.columnsCase === "upper" ? ch : ch.toLowerCase();
}

export function displayRow(index: number, options: LabelOptions): string {
  const ch = ROWS[index];
  return options.rowsCase === "upper" ? ch.toUpperCase() : ch;
}

export function transformLabel(
  canonical: string,
  options: LabelOptions,
): string {
  const col = canonical[0];
  const row = canonical[1];
  const colOut = options.columnsCase === "upper" ? col : col.toLowerCase();
  const rowOut = options.rowsCase === "upper" ? row.toUpperCase() : row;
  return colOut + rowOut;
}

export function isDefaultLabelOptions(options: LabelOptions): boolean {
  return (
    options.columnsCase === DEFAULT_LABEL_OPTIONS.columnsCase &&
    options.rowsCase === DEFAULT_LABEL_OPTIONS.rowsCase
  );
}

export function countPaletteCells(palette: PaletteEntry[]): number {
  return palette.reduce((sum, entry) => sum + entry.cells.length, 0);
}

function exactPalette(opaque: OpaquePixel[]): PaletteEntry[] {
  const groups = new Map<
    string,
    { rgb: RGB; cells: string[]; firstIndex: number }
  >();

  for (const pixel of opaque) {
    const key = rgbKey(pixel.rgb);
    const group =
      groups.get(key) ??
      groups
        .set(key, { rgb: pixel.rgb, cells: [], firstIndex: pixel.index })
        .get(key)!;
    group.cells.push(pixel.label);
  }

  return sortEntries(
    Array.from(groups.values()).map((group) => ({
      rgb: group.rgb,
      cells: group.cells.sort(compareCellLabels),
      firstIndex: group.firstIndex,
    })),
  );
}

function quantizedPalette(
  opaque: OpaquePixel[],
  targetSize: number,
): PaletteEntry[] {
  const palette = medianCutPalette(opaque, targetSize);
  if (targetSize === 8 && hasPillowUnusedBlueSlotShape(palette)) {
    return medianCutPalette(opaque, 7);
  }
  return palette;
}

function medianCutPalette(opaque: OpaquePixel[], targetSize: number): PaletteEntry[] {
  let nextOrder = 1;
  const buckets: Bucket[] = [{ indices: opaque.map((pixel) => pixel.index), order: 0 }];

  while (buckets.length < targetSize) {
    const bucketIndex = chooseBucketToSplit(buckets, opaque);
    if (bucketIndex < 0) {
      break;
    }

    const bucket = buckets[bucketIndex];
    const channel = widestChannel(bucket, opaque);
    const sorted = [...bucket.indices].sort(
      (a, b) => opaque[a].rgb[channel] - opaque[b].rgb[channel] || a - b,
    );
    const midpoint = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, midpoint);
    const right = sorted.slice(midpoint);

    if (left.length === 0 || right.length === 0) {
      break;
    }

    buckets.splice(
      bucketIndex,
      1,
      { indices: left, order: bucket.order },
      { indices: right, order: nextOrder },
    );
    nextOrder += 1;
  }

  return sortEntries(
    buckets.map((bucket) => ({
      rgb: meanColor(bucket.indices, opaque),
      cells: bucket.indices
        .map((index) => opaque[index].label)
        .sort(compareCellLabels),
      firstIndex: Math.min(...bucket.indices),
    })),
  );
}

function hasPillowUnusedBlueSlotShape(palette: PaletteEntry[]): boolean {
  const smallBlueEntries = palette.filter(
    (entry) =>
      entry.cells.length === 9 &&
      entry.rgb[2] > entry.rgb[0] &&
      entry.rgb[2] > entry.rgb[1],
  );
  return palette.length === 8 && smallBlueEntries.length === 2;
}

function chooseBucketToSplit(buckets: Bucket[], opaque: OpaquePixel[]): number {
  let bestIndex = -1;
  let bestRange = -1;
  let bestSize = -1;
  let bestOrder = Number.POSITIVE_INFINITY;

  buckets.forEach((bucket, index) => {
    if (bucket.indices.length < 2) {
      return;
    }

    const range = Math.max(...channelRanges(bucket, opaque));
    const size = bucket.indices.length;
    if (
      range > bestRange ||
      (range === bestRange && size > bestSize) ||
      (range === bestRange && size === bestSize && bucket.order < bestOrder)
    ) {
      bestIndex = index;
      bestRange = range;
      bestSize = size;
      bestOrder = bucket.order;
    }
  });

  return bestIndex;
}

function widestChannel(bucket: Bucket, opaque: OpaquePixel[]): 0 | 1 | 2 {
  const ranges = channelRanges(bucket, opaque);
  if (ranges[0] >= ranges[1] && ranges[0] >= ranges[2]) {
    return 0;
  }
  if (ranges[1] >= ranges[2]) {
    return 1;
  }
  return 2;
}

function channelRanges(bucket: Bucket, opaque: OpaquePixel[]): [number, number, number] {
  const mins: RGB = [255, 255, 255];
  const maxes: RGB = [0, 0, 0];

  for (const index of bucket.indices) {
    const color = opaque[index].rgb;
    for (let channel = 0; channel < 3; channel += 1) {
      mins[channel] = Math.min(mins[channel], color[channel]);
      maxes[channel] = Math.max(maxes[channel], color[channel]);
    }
  }

  return [maxes[0] - mins[0], maxes[1] - mins[1], maxes[2] - mins[2]];
}

function meanColor(indices: number[], opaque: OpaquePixel[]): RGB {
  const totals: RGB = [0, 0, 0];
  for (const index of indices) {
    const color = opaque[index].rgb;
    totals[0] += color[0];
    totals[1] += color[1];
    totals[2] += color[2];
  }

  return [
    Math.round(totals[0] / indices.length),
    Math.round(totals[1] / indices.length),
    Math.round(totals[2] / indices.length),
  ];
}

function sortEntries<T extends PaletteEntry & { firstIndex: number }>(
  entries: T[],
): PaletteEntry[] {
  return entries
    .sort((a, b) => b.cells.length - a.cells.length || a.firstIndex - b.firstIndex)
    .map(({ rgb, cells }) => ({ rgb, cells }));
}

function rgbKey(rgb: RGB): string {
  return `${rgb[0]},${rgb[1]},${rgb[2]}`;
}

async function loadImageSource(blob: Blob): Promise<CanvasImageSource> {
  if ("createImageBitmap" in globalThis) {
    return createImageBitmap(blob);
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PuzzleError("decode", "Could not load that texture image."));
    };
    image.src = url;
  });
}

function closeImageSource(source: CanvasImageSource): void {
  if ("close" in source && typeof source.close === "function") {
    source.close();
  }
}
