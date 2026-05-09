/**
 * Node-side helper to decode a 16x16 PNG into something structurally
 * compatible with the DOM `ImageData` shape that lib/palette.ts expects.
 *
 * NOT for browser use. The browser path uses canvas via lib/palette.ts.
 *
 * Marked with a thin `as unknown as ImageData` so the rest of the pipeline
 * can stay typed against the DOM lib without us pulling node-canvas just to
 * satisfy a structural shape.
 */

import { PNG } from "pngjs";
import { GRID_N } from "@/lib/palette";

export interface NodeImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export function decodePngToImageData(bytes: Uint8Array): NodeImageDataLike {
  const png = PNG.sync.read(Buffer.from(bytes));
  const sourceData = new Uint8ClampedArray(
    png.data.buffer,
    png.data.byteOffset,
    png.data.byteLength,
  );

  if (png.width === GRID_N && png.height === GRID_N) {
    return { width: png.width, height: png.height, data: sourceData };
  }

  // Some wiki textures (Slime_Ball, Cactus) ship as 32x32. The browser path
  // resamples to 16x16 with nearest-neighbor + imageSmoothingEnabled=false.
  // Match that behaviour here so build-catalog can compute difficulty for
  // every catalog item.
  return nearestNeighborTo16(png.width, png.height, sourceData);
}

function nearestNeighborTo16(
  srcW: number,
  srcH: number,
  src: Uint8ClampedArray,
): NodeImageDataLike {
  const dst = new Uint8ClampedArray(GRID_N * GRID_N * 4);
  for (let dy = 0; dy < GRID_N; dy += 1) {
    const sy = Math.min(srcH - 1, Math.floor((dy * srcH) / GRID_N));
    for (let dx = 0; dx < GRID_N; dx += 1) {
      const sx = Math.min(srcW - 1, Math.floor((dx * srcW) / GRID_N));
      const sOff = (sy * srcW + sx) * 4;
      const dOff = (dy * GRID_N + dx) * 4;
      dst[dOff] = src[sOff];
      dst[dOff + 1] = src[sOff + 1];
      dst[dOff + 2] = src[sOff + 2];
      dst[dOff + 3] = src[sOff + 3];
    }
  }
  return { width: GRID_N, height: GRID_N, data: dst };
}

export function asImageData(like: NodeImageDataLike): ImageData {
  return like as unknown as ImageData;
}
