"use client";

// Live SVG visualizer for a Maze Hunt worksheet.
//
// Renders the same two-up Letter portrait layout that lib/pdf/mazeHunt.ts
// commits to PDF — but in-browser, in real time, so Davis can SEE what he's
// building as he turns each knob. The component is pure (no fetching, no
// state mutation): every input arrives via props.
//
// Coordinate system: native SVG (origin top-left, y grows down). The PDF
// builder uses bottom-left origin; the visualizer doesn't have to share that
// convention because it only consumes the same MazeGrid + Placement data,
// not the PDF coords.

import { useMemo } from "react";
import type { Assembly, AssemblySlot } from "@/lib/assemblies";
import type { MazeCell, MazeGrid, WallSegment } from "@/lib/maze";
import type { Placement } from "@/lib/placement";
import type { Objective } from "@/lib/objectives";

const PAGE_W = 612;
const PAGE_H = 792;
const HALF_H = 396;

const OUTER_MARGIN_X = 36;
const HALF_INNER_TOP_PAD = 16;
const HALF_INNER_BOTTOM_PAD = 24;

const LEFT_COL_X = 36;
const LEFT_COL_W = 320;
const COL_GUTTER = 16;
const RIGHT_COL_X = LEFT_COL_X + LEFT_COL_W + COL_GUTTER;
const RIGHT_COL_W = PAGE_W - OUTER_MARGIN_X - RIGHT_COL_X;

const HEADER_BAND_H = 32;
const CHECKLIST_BLOCK_H = 90;
const ASSEMBLY_BLOCK_H = 180;

const CUTOUT_SIZE_PT: Record<"small" | "medium" | "large", number> = {
  small: 16,
  medium: 22,
  large: 28,
};

export type CutoutSize = "small" | "medium" | "large";

export interface WorksheetSnapshot {
  grid: MazeGrid;
  collectibles: Placement[];
  boss?: { cell: MazeCell; itemRef: string };
  assembly?: Assembly;
  objectives: Objective[];
  cutoutSize: CutoutSize;
  themeDisplayName: string;
  difficulty: string;
  bwSafe: boolean;
  sessionLabel: string;
  presetName?: string;
}

export interface MazeHuntVisualizerProps {
  snapshot: WorksheetSnapshot;
  /** Map of canonicalName → object URL for sprite PNG. */
  spriteUrls: Record<string, string>;
  /** "two-up" mirrors the default PDF; "child" / "answer" focus on one half. */
  view?: "two-up" | "child" | "answer";
}

export function MazeHuntVisualizer({
  snapshot,
  spriteUrls,
  view = "two-up",
}: MazeHuntVisualizerProps) {
  const showChild = view === "two-up" || view === "child";
  const showAnswer = view === "two-up" || view === "answer";

  // For the "child" or "answer" focused views, we render only that half but
  // shift it to fill the full SVG canvas so the result feels page-sized.
  const focusedYOffset = view === "answer" ? HALF_H : 0;

  return (
    <svg
      viewBox={
        view === "two-up"
          ? `0 0 ${PAGE_W} ${PAGE_H}`
          : `0 ${focusedYOffset} ${PAGE_W} ${HALF_H}`
      }
      className="block h-auto w-full max-w-3xl rounded-md border border-[var(--border)] bg-white shadow-sm"
      role="img"
      aria-label={`${snapshot.themeDisplayName} worksheet preview`}
    >
      {/* Page background */}
      <rect x={0} y={0} width={PAGE_W} height={PAGE_H} fill="white" />

      {showChild ? (
        <Half
          snapshot={snapshot}
          spriteUrls={spriteUrls}
          yTop={0}
          showSolutionPath={false}
          showAssemblyAnswerKey={false}
          drawWatermark={false}
        />
      ) : null}

      {view === "two-up" ? (
        <line
          x1={OUTER_MARGIN_X}
          x2={PAGE_W - OUTER_MARGIN_X}
          y1={HALF_H}
          y2={HALF_H}
          stroke="rgb(102,102,102)"
          strokeWidth={0.4}
        />
      ) : null}

      {showAnswer ? (
        <Half
          snapshot={snapshot}
          spriteUrls={spriteUrls}
          yTop={view === "two-up" ? HALF_H : focusedYOffset}
          showSolutionPath
          showAssemblyAnswerKey
          drawWatermark
        />
      ) : null}

      {/* Footer */}
      <Footer snapshot={snapshot} />
    </svg>
  );
}

interface HalfProps {
  snapshot: WorksheetSnapshot;
  spriteUrls: Record<string, string>;
  yTop: number;
  showSolutionPath: boolean;
  showAssemblyAnswerKey: boolean;
  drawWatermark: boolean;
}

function Half({
  snapshot,
  spriteUrls,
  yTop,
  showSolutionPath,
  showAssemblyAnswerKey,
  drawWatermark,
}: HalfProps) {
  const halfBody = {
    top: yTop + HALF_INNER_TOP_PAD,
    bottom: yTop + HALF_H - HALF_INNER_BOTTOM_PAD,
  };

  // Header band sits at top of half body.
  const headerBaseY = halfBody.top + HEADER_BAND_H;
  const bodyTop = headerBaseY + 4;
  const bodyBottom = halfBody.bottom;

  // Left column: checklist on top, maze fills the rest.
  const checklistRect = {
    x: LEFT_COL_X,
    y: bodyTop,
    width: LEFT_COL_W,
    height: CHECKLIST_BLOCK_H,
  };
  const mazeRect = {
    x: LEFT_COL_X,
    y: checklistRect.y + checklistRect.height + 6,
    width: LEFT_COL_W,
    height: bodyBottom - (checklistRect.y + checklistRect.height + 6),
  };

  // Right column: assembly target on top, cutouts below.
  const cellPt = CUTOUT_SIZE_PT[snapshot.cutoutSize];
  const assemblyRows = snapshot.assembly?.gridShape.length ?? 0;
  const assemblyHeight = Math.min(
    ASSEMBLY_BLOCK_H,
    assemblyRows * cellPt + 28,
  );
  const assemblyRect = {
    x: RIGHT_COL_X,
    y: bodyTop,
    width: RIGHT_COL_W,
    height: assemblyHeight,
  };
  const cutoutsRect = {
    x: RIGHT_COL_X,
    y: assemblyRect.y + assemblyRect.height + 12,
    width: RIGHT_COL_W,
    height: bodyBottom - (assemblyRect.y + assemblyRect.height + 12),
  };

  return (
    <g>
      {/* Header band: Objectives badge left, Name line right */}
      <text
        x={OUTER_MARGIN_X}
        y={halfBody.top + 14}
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize={10}
        fill="rgb(60,60,60)"
      >
        Objectives: {snapshot.objectives.length}
      </text>
      <line
        x1={RIGHT_COL_X}
        x2={PAGE_W - OUTER_MARGIN_X}
        y1={halfBody.top + 18}
        y2={halfBody.top + 18}
        stroke="rgb(140,140,140)"
        strokeWidth={0.6}
      />
      <text
        x={RIGHT_COL_X}
        y={halfBody.top + 28}
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize={9}
        fill="rgb(120,120,120)"
      >
        Name
      </text>

      {/* Checklist */}
      <Checklist objectives={snapshot.objectives} rect={checklistRect} />

      {/* Maze */}
      {mazeRect.height > 40 ? (
        <Maze
          grid={snapshot.grid}
          collectibles={snapshot.collectibles}
          boss={snapshot.boss}
          spriteUrls={spriteUrls}
          rect={mazeRect}
          showSolutionPath={showSolutionPath}
          bwSafe={snapshot.bwSafe}
        />
      ) : null}

      {/* Assembly + cutouts */}
      {snapshot.assembly ? (
        <>
          <AssemblyPanel
            assembly={snapshot.assembly}
            rect={assemblyRect}
            cutoutSize={snapshot.cutoutSize}
            showAnswerKey={showAssemblyAnswerKey}
            spriteUrls={spriteUrls}
          />
          {cutoutsRect.height > cellPt + 6 ? (
            <CutoutStrip
              assembly={snapshot.assembly}
              rect={cutoutsRect}
              cutoutSize={snapshot.cutoutSize}
              spriteUrls={spriteUrls}
            />
          ) : null}
        </>
      ) : null}

      {/* Watermark on the answer half */}
      {drawWatermark ? (
        <text
          x={PAGE_W / 2}
          y={yTop + HALF_H / 2}
          fontFamily="Helvetica, Arial, sans-serif"
          fontSize={48}
          fill="rgb(140,140,140)"
          fillOpacity={0.15}
          textAnchor="middle"
          transform={`rotate(-30 ${PAGE_W / 2} ${yTop + HALF_H / 2})`}
        >
          FACILITATOR COPY
        </text>
      ) : null}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

interface ChecklistProps {
  objectives: Objective[];
  rect: { x: number; y: number; width: number; height: number };
}

function Checklist({ objectives, rect }: ChecklistProps) {
  const fontSize = 9;
  const lineHeight = 12;
  const checkboxSize = 8;
  // Naive width-aware wrap: count chars per line ~ rect.width / (fontSize*0.5).
  // Helvetica avg width ≈ 0.5 × fontSize at this size. This is a rough preview;
  // the printed PDF wraps with the real font metrics.
  const approxCharsPerLine = Math.floor(
    (rect.width - checkboxSize - 6) / (fontSize * 0.5),
  );
  const rows: { text: string; mismatch: boolean; checkboxY: number }[] = [];
  let y = rect.y + lineHeight;
  for (const o of objectives) {
    const lines = wrapText(o.text, approxCharsPerLine);
    for (let i = 0; i < lines.length; i += 1) {
      rows.push({
        text: lines[i] ?? "",
        mismatch: i === 0 && o.countMismatch !== undefined,
        checkboxY: i === 0 ? y - 7 : -1,
      });
      y += lineHeight;
      if (y > rect.y + rect.height) break;
    }
    if (y > rect.y + rect.height) break;
  }
  return (
    <g>
      {rows.map((row, i) => (
        <g key={i}>
          {row.checkboxY >= 0 ? (
            <rect
              x={rect.x}
              y={row.checkboxY}
              width={checkboxSize}
              height={checkboxSize}
              fill="white"
              stroke="rgb(40,40,40)"
              strokeWidth={0.5}
            />
          ) : null}
          <text
            x={rect.x + checkboxSize + 4}
            y={rect.y + (i + 1) * lineHeight}
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize={fontSize}
            fill="rgb(20,20,20)"
          >
            {row.text}
          </text>
          {row.mismatch ? (
            <circle
              cx={rect.x + rect.width - 6}
              cy={rect.y + (i + 1) * lineHeight - 3}
              r={3.5}
              fill="rgb(217,119,6)"
            />
          ) : null}
        </g>
      ))}
    </g>
  );
}

function wrapText(text: string, charsPerLine: number): string[] {
  if (charsPerLine <= 0) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length === 0) {
      cur = w;
    } else if (cur.length + 1 + w.length <= charsPerLine) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Maze
// ---------------------------------------------------------------------------

interface MazeRenderProps {
  grid: MazeGrid;
  collectibles: Placement[];
  boss?: { cell: MazeCell; itemRef: string };
  spriteUrls: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  showSolutionPath: boolean;
  bwSafe: boolean;
}

interface MazeMetrics {
  cell: number;
  originX: number;
  originY: number;
  drawnWidth: number;
  drawnHeight: number;
}

function computeMazeMetrics(
  grid: MazeGrid,
  rect: { x: number; y: number; width: number; height: number },
): MazeMetrics {
  const cellByWidth = rect.width / grid.cellsAcross;
  const cellByHeight = rect.height / grid.cellsDown;
  const cell = Math.min(cellByWidth, cellByHeight);
  const drawnWidth = cell * grid.cellsAcross;
  const drawnHeight = cell * grid.cellsDown;
  const originX = rect.x + (rect.width - drawnWidth) / 2;
  const originY = rect.y + (rect.height - drawnHeight) / 2;
  return { cell, originX, originY, drawnWidth, drawnHeight };
}

function Maze({
  grid,
  collectibles,
  boss,
  spriteUrls,
  rect,
  showSolutionPath,
  bwSafe,
}: MazeRenderProps) {
  const m = useMemo(() => computeMazeMetrics(grid, rect), [grid, rect]);
  const { boundary, interior } = useMemo(() => {
    const b: WallSegment[] = [];
    const i: WallSegment[] = [];
    for (const w of grid.walls) {
      if (w.kind === "boundary") b.push(w);
      else i.push(w);
    }
    return { boundary: b, interior: i };
  }, [grid.walls]);

  const wallToSvgPath = (segs: WallSegment[]): string => {
    const parts: string[] = [];
    for (const s of segs) {
      const x1 = m.originX + s.x1 * m.cell;
      const y1 = m.originY + s.y1 * m.cell;
      const x2 = m.originX + s.x2 * m.cell;
      const y2 = m.originY + s.y2 * m.cell;
      parts.push(`M ${x1} ${y1} L ${x2} ${y2}`);
    }
    return parts.join(" ");
  };

  const cellCenter = (c: MazeCell): { x: number; y: number } => ({
    x: m.originX + (c.x + 0.5) * m.cell,
    y: m.originY + (c.y + 0.5) * m.cell,
  });

  const solutionPath = useMemo(() => {
    if (!showSolutionPath || grid.solutionPath.length < 2) return "";
    const parts: string[] = [];
    grid.solutionPath.forEach((c, idx) => {
      const p = cellCenter(c);
      parts.push(`${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`);
    });
    return parts.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.solutionPath, showSolutionPath, m]);

  const entryArrow = useMemo(
    () => arrowAtCell(grid, grid.entrance, m, "entry"),
    [grid, m],
  );
  const exitArrow = useMemo(
    () => arrowAtCell(grid, grid.exit, m, "exit"),
    [grid, m],
  );

  return (
    <g>
      <path
        d={wallToSvgPath(boundary)}
        stroke="black"
        strokeWidth={1.5}
        strokeLinecap="square"
        fill="none"
      />
      <path
        d={wallToSvgPath(interior)}
        stroke="black"
        strokeWidth={0.75}
        strokeLinecap="square"
        fill="none"
      />
      {showSolutionPath && solutionPath ? (
        bwSafe ? (
          <path
            d={solutionPath}
            stroke="black"
            strokeWidth={1.0}
            strokeDasharray="6 4"
            strokeLinecap="round"
            strokeOpacity={0.95}
            fill="none"
          />
        ) : (
          <path
            d={solutionPath}
            stroke="rgb(217,40,40)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeOpacity={0.85}
            fill="none"
          />
        )
      ) : null}
      {entryArrow}
      {exitArrow}
      {/* Collectibles */}
      {collectibles.map((p, i) => (
        <CellSprite
          key={`coll-${i}`}
          cell={p.cell}
          itemRef={p.itemRef}
          metrics={m}
          spriteUrls={spriteUrls}
          scale={0.8}
        />
      ))}
      {/* Boss */}
      {boss ? (
        <CellSprite
          cell={boss.cell}
          itemRef={boss.itemRef}
          metrics={m}
          spriteUrls={spriteUrls}
          scale={1.4}
        />
      ) : null}
    </g>
  );
}

interface CellSpriteProps {
  cell: MazeCell;
  itemRef: string;
  metrics: MazeMetrics;
  spriteUrls: Record<string, string>;
  scale: number;
}

function CellSprite({
  cell,
  itemRef,
  metrics,
  spriteUrls,
  scale,
}: CellSpriteProps) {
  const url = spriteUrls[itemRef];
  if (!url) return null;
  const cx = metrics.originX + (cell.x + 0.5) * metrics.cell;
  const cy = metrics.originY + (cell.y + 0.5) * metrics.cell;
  const target = metrics.cell * scale;
  const x = cx - target / 2;
  const y = cy - target / 2;
  return (
    <image
      href={url}
      x={x}
      y={y}
      width={target}
      height={target}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

function arrowAtCell(
  grid: MazeGrid,
  cell: MazeCell,
  m: MazeMetrics,
  kind: "entry" | "exit",
): React.ReactNode {
  // Pick the inward direction (the one cardinal neighbor that's in-shape).
  const candidates: Array<{ dir: "N" | "S" | "E" | "W"; dx: number; dy: number }> = [
    { dir: "S", dx: 0, dy: 1 },
    { dir: "N", dx: 0, dy: -1 },
    { dir: "E", dx: 1, dy: 0 },
    { dir: "W", dx: -1, dy: 0 },
  ];
  let dir: "N" | "S" | "E" | "W" = "S";
  for (const c of candidates) {
    const nx = cell.x + c.dx;
    const ny = cell.y + c.dy;
    if (
      ny >= 0 &&
      ny < grid.cellsDown &&
      nx >= 0 &&
      nx < grid.cellsAcross &&
      grid.inShape[ny]?.[nx] === true
    ) {
      dir = c.dir;
      break;
    }
  }
  const cx = m.originX + (cell.x + 0.5) * m.cell;
  const cy = m.originY + (cell.y + 0.5) * m.cell;
  const offset = m.cell * 0.85;
  let ax = cx;
  let ay = cy;
  if (dir === "S") ay -= offset;
  else if (dir === "N") ay += offset;
  else if (dir === "E") ax -= offset;
  else ax += offset;
  const size = Math.max(6, m.cell * 0.55);
  const half = size / 2;
  let p1x = 0;
  let p1y = 0;
  let p2x = 0;
  let p2y = 0;
  let p3x = 0;
  let p3y = 0;
  if (dir === "N") {
    p1x = ax; p1y = ay - half;
    p2x = ax - half; p2y = ay + half;
    p3x = ax + half; p3y = ay + half;
  } else if (dir === "S") {
    p1x = ax; p1y = ay + half;
    p2x = ax - half; p2y = ay - half;
    p3x = ax + half; p3y = ay - half;
  } else if (dir === "E") {
    p1x = ax + half; p1y = ay;
    p2x = ax - half; p2y = ay - half;
    p3x = ax - half; p3y = ay + half;
  } else {
    p1x = ax - half; p1y = ay;
    p2x = ax + half; p2y = ay - half;
    p3x = ax + half; p3y = ay + half;
  }
  const fill = kind === "entry" ? "rgb(40,99,217)" : "rgb(217,40,40)";
  return (
    <polygon
      points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`}
      fill={fill}
      stroke={fill}
      strokeWidth={0.8}
    />
  );
}

// ---------------------------------------------------------------------------
// Assembly target
// ---------------------------------------------------------------------------

interface AssemblyPanelProps {
  assembly: Assembly;
  rect: { x: number; y: number; width: number; height: number };
  cutoutSize: CutoutSize;
  showAnswerKey: boolean;
  spriteUrls: Record<string, string>;
}

function AssemblyPanel({
  assembly,
  rect,
  cutoutSize,
  showAnswerKey,
  spriteUrls,
}: AssemblyPanelProps) {
  const cellPt = CUTOUT_SIZE_PT[cutoutSize];
  const cols = Math.max(1, ...assembly.gridShape.map((r) => r.length));
  const width = cols * cellPt;
  const startX = rect.x + (rect.width - width) / 2;
  const labelHeight = 14;
  const gridTop = rect.y + labelHeight;

  const slotElements: React.ReactNode[] = [];
  for (let r = 0; r < assembly.gridShape.length; r += 1) {
    const row = assembly.gridShape[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c += 1) {
      const slot = row[c];
      if (!slot) continue;
      const slotX = startX + c * cellPt;
      const slotY = gridTop + r * cellPt;
      slotElements.push(
        <Slot
          key={`s-${r}-${c}`}
          slot={slot}
          x={slotX}
          y={slotY}
          cellPt={cellPt}
          showAnswerKey={
            showAnswerKey && assembly.answerKeyDefault === "pre-pasted"
          }
          spriteUrls={spriteUrls}
        />,
      );
    }
  }

  return (
    <g>
      <text
        x={startX + width / 2}
        y={rect.y + 10}
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize={10}
        fontWeight={600}
        fill="rgb(20,20,20)"
        textAnchor="middle"
      >
        {assembly.displayName}
      </text>
      {slotElements}
    </g>
  );
}

interface SlotProps {
  slot: AssemblySlot;
  x: number;
  y: number;
  cellPt: number;
  showAnswerKey: boolean;
  spriteUrls: Record<string, string>;
}

function Slot({ slot, x, y, cellPt, showAnswerKey, spriteUrls }: SlotProps) {
  if (slot.kind === "blank") return null;

  const showSprite =
    slot.kind === "decorative" ||
    (slot.kind === "paste" && showAnswerKey);
  const itemRef =
    slot.kind === "decorative"
      ? slot.item
      : slot.kind === "paste"
        ? slot.answerItem
        : null;
  const url = itemRef ? spriteUrls[itemRef] : undefined;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={cellPt}
        height={cellPt}
        fill="rgb(247,247,247)"
        stroke="rgb(127,127,127)"
        strokeWidth={0.6}
      />
      {showSprite && url ? (
        <image
          href={url}
          x={x + 2}
          y={y + 2}
          width={cellPt - 4}
          height={cellPt - 4}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : null}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Cutout strip
// ---------------------------------------------------------------------------

interface CutoutStripProps {
  assembly: Assembly;
  rect: { x: number; y: number; width: number; height: number };
  cutoutSize: CutoutSize;
  spriteUrls: Record<string, string>;
}

function CutoutStrip({ assembly, rect, cutoutSize, spriteUrls }: CutoutStripProps) {
  const cellPt = CUTOUT_SIZE_PT[cutoutSize];
  const gap = 4;

  const flat: string[] = [];
  for (const c of assembly.cutoutPanel) {
    for (let i = 0; i < c.count; i += 1) flat.push(c.item);
  }

  const cols = Math.max(1, Math.floor((rect.width + gap) / (cellPt + gap)));
  const usedRows = Math.ceil(flat.length / cols);
  const totalH = usedRows * (cellPt + gap) - gap;
  const startX = rect.x + (rect.width - cols * (cellPt + gap) + gap) / 2;
  const startY = rect.y + Math.max(0, (rect.height - totalH - 14) / 2) + 14;

  return (
    <g>
      <text
        x={rect.x + rect.width / 2}
        y={rect.y + 10}
        fontFamily="Helvetica, Arial, sans-serif"
        fontSize={9}
        fontWeight={600}
        fill="rgb(80,80,80)"
        textAnchor="middle"
      >
        Cutouts
      </text>
      {flat.map((itemRef, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        if (startY + (r + 1) * (cellPt + gap) > rect.y + rect.height) {
          return null;
        }
        const x = startX + c * (cellPt + gap);
        const y = startY + r * (cellPt + gap);
        const url = spriteUrls[itemRef];
        return (
          <g key={`co-${i}`}>
            <rect
              x={x}
              y={y}
              width={cellPt}
              height={cellPt}
              fill="white"
              stroke="black"
              strokeWidth={1.0}
            />
            {url ? (
              <image
                href={url}
                x={x + 2}
                y={y + 2}
                width={cellPt - 4}
                height={cellPt - 4}
                preserveAspectRatio="xMidYMid meet"
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer({ snapshot }: { snapshot: WorksheetSnapshot }) {
  const today = new Date().toISOString().slice(0, 10);
  const sizeDescriptor =
    snapshot.grid.cellsAcross >= 22
      ? "L"
      : snapshot.grid.cellsAcross >= 18
        ? "M"
        : "S";
  const cutDescriptor =
    snapshot.cutoutSize === "small"
      ? "S"
      : snapshot.cutoutSize === "large"
        ? "L"
        : "M";
  const parts: string[] = [];
  if (snapshot.presetName) parts.push(snapshot.presetName);
  parts.push(`Maze Hunt — ${snapshot.themeDisplayName}`);
  parts.push(
    `Maze: ${sizeDescriptor} / Cutouts: ${cutDescriptor} / Objectives: ${snapshot.objectives.length}`,
  );
  parts.push(today);
  if (snapshot.sessionLabel.trim()) parts.push(snapshot.sessionLabel.trim());
  const text = parts.join("  ·  ");
  return (
    <text
      x={36}
      y={PAGE_H - 16}
      fontFamily="Helvetica, Arial, sans-serif"
      fontStyle="italic"
      fontSize={8}
      fill="rgb(115,115,115)"
    >
      {text}
    </text>
  );
}
