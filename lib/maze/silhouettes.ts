// In-shape rasterizers for the three v1 silhouettes (rectangle, circle, star4).
// Output is `inShape[y][x]: boolean` over a [cellsDown][cellsAcross] grid.
// Boundary helpers: pick the in-shape cell at a cardinal side of the silhouette.

export type CardinalPosition = "N" | "S" | "E" | "W";

export interface MazeCell {
  x: number;
  y: number;
}

function makeFalseGrid(cellsDown: number, cellsAcross: number): boolean[][] {
  const out: boolean[][] = [];
  for (let y = 0; y < cellsDown; y++) {
    const row: boolean[] = new Array(cellsAcross).fill(false);
    out.push(row);
  }
  return out;
}

export function rectangle(width: number, height: number): boolean[][] {
  const out = makeFalseGrid(height, width);
  for (let y = 0; y < height; y++) {
    const row = out[y];
    if (!row) continue;
    for (let x = 0; x < width; x++) {
      row[x] = true;
    }
  }
  return out;
}

export function circle(cellsAcross: number): boolean[][] {
  const N = cellsAcross;
  const out = makeFalseGrid(N, N);
  const cx = (N - 1) / 2;
  const cy = (N - 1) / 2;
  // Use cell-center distance with a small fudge so the cardinal boundary cells
  // are always in-shape (avoids surprise tip dropouts at smaller sizes).
  const radius = N / 2;
  for (let y = 0; y < N; y++) {
    const row = out[y];
    if (!row) continue;
    for (let x = 0; x < N; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius - 0.5 + 1e-6) {
        row[x] = true;
      }
    }
  }
  return out;
}

export function star4(cellsAcross: number): boolean[][] {
  // 4-point star = union of two axis-aligned squares rotated 45° relative to
  // each other. Per the spec (planning §3.2 + §7.4):
  //   - Diamond (square rotated 45°): dx + dy <= R — tips reach cardinal edges.
  //   - Inner axis-aligned square:    max(dx, dy) <= R * 0.7 — a wide center
  //     band whose corners poke past the diamond's diagonals at NE/NW/SE/SW.
  // The union is a 4-point star with cardinal-direction tips reaching the
  // bounding-box edges and a beefy center body that reads as a star, not a
  // pure diamond. The 0.7 factor was chosen so the diagonal "shoulders" of
  // the inner square clearly extrude past the diamond at typical sizes
  // (14 / 18 / 22 cells across) without making the star look like a square.
  const N = cellsAcross;
  const out = makeFalseGrid(N, N);
  const cx = (N - 1) / 2;
  const cy = (N - 1) / 2;
  const R = (N - 1) / 2;
  const wHalf = R * 0.7;
  const dHalf = R;
  for (let y = 0; y < N; y++) {
    const row = out[y];
    if (!row) continue;
    for (let x = 0; x < N; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const inDiamond = dx + dy <= dHalf + 1e-6;
      const inInner = Math.max(dx, dy) <= wHalf + 1e-6;
      if (inDiamond || inInner) {
        row[x] = true;
      }
    }
  }
  return out;
}

export function findEntranceCell(
  inShape: boolean[][],
  position: CardinalPosition,
): MazeCell {
  const cellsDown = inShape.length;
  const firstRow = inShape[0];
  const cellsAcross = firstRow ? firstRow.length : 0;
  if (cellsDown === 0 || cellsAcross === 0) {
    throw new Error("findEntranceCell: empty inShape grid");
  }

  const isIn = (x: number, y: number): boolean => {
    if (y < 0 || y >= cellsDown || x < 0 || x >= cellsAcross) return false;
    const row = inShape[y];
    return row !== undefined && row[x] === true;
  };

  // For each cardinal, walk inward from the edge along the center axis until
  // we find an in-shape cell. If the center column/row is out-of-shape (e.g.
  // a star tip is offset), spiral outward along the perpendicular axis.
  const cxMid = Math.floor((cellsAcross - 1) / 2);
  const cyMid = Math.floor((cellsDown - 1) / 2);

  const search = (axis: "h" | "v", inward: 1 | -1): MazeCell | null => {
    if (axis === "v") {
      // North (inward=+1) / South (inward=-1): vary y.
      const startY = inward === 1 ? 0 : cellsDown - 1;
      const endY = inward === 1 ? cellsDown : -1;
      for (let y = startY; y !== endY; y += inward) {
        // Try center column first, then spiral outward.
        for (let off = 0; off <= cellsAcross; off++) {
          const candidates = off === 0 ? [cxMid] : [cxMid - off, cxMid + off];
          for (const x of candidates) {
            if (isIn(x, y)) return { x, y };
          }
        }
      }
      return null;
    }
    // East (inward=-1) / West (inward=+1): vary x.
    const startX = inward === 1 ? 0 : cellsAcross - 1;
    const endX = inward === 1 ? cellsAcross : -1;
    for (let x = startX; x !== endX; x += inward) {
      for (let off = 0; off <= cellsDown; off++) {
        const candidates = off === 0 ? [cyMid] : [cyMid - off, cyMid + off];
        for (const y of candidates) {
          if (isIn(x, y)) return { x, y };
        }
      }
    }
    return null;
  };

  let result: MazeCell | null = null;
  if (position === "N") result = search("v", 1);
  else if (position === "S") result = search("v", -1);
  else if (position === "W") result = search("h", 1);
  else result = search("h", -1);

  if (!result) {
    throw new Error(`findEntranceCell: no in-shape cell found for ${position}`);
  }
  return result;
}
