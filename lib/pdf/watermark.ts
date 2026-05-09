// "FACILITATOR COPY" watermark for the answer-key half / page.
//
// pdf-lib draws rotated text around an anchor; we approximate-center it
// against the supplied region so it lives across the answer copy without
// drowning content. Light gray + 0.15 opacity per plan.md §3 (R5 / watermark).

import { degrees, rgb as pdfRgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface WatermarkRect {
  /** Bottom-left of the region the watermark should sit inside. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatermarkOptions {
  font: PDFFont;
  text?: string;
  /** Default 48pt. */
  size?: number;
  /** Default 0.15. */
  opacity?: number;
  /** Default -30. */
  rotateDegrees?: number;
}

const GRAY = pdfRgb(0.55, 0.55, 0.55);

export function drawFacilitatorWatermark(
  page: PDFPage,
  rect: WatermarkRect,
  options: WatermarkOptions,
): void {
  const text = options.text ?? "FACILITATOR COPY";
  const size = options.size ?? 48;
  const opacity = options.opacity ?? 0.15;
  const rotation = options.rotateDegrees ?? -30;

  const textWidth = options.font.widthOfTextAtSize(text, size);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  // pdf-lib rotates around the (x, y) anchor; offset so the text visually
  // straddles the region center.
  const x = cx - textWidth / 2;
  const y = cy - size / 2;

  page.drawText(text, {
    x,
    y,
    size,
    font: options.font,
    color: GRAY,
    opacity,
    rotate: degrees(rotation),
  });
}
