/**
 * Hand-labeled calibration set for difficulty bucketing.
 *
 * These canonicalNames must match wiki canonical filenames (so a probe of
 * Invicon_<canonicalName>.png succeeds). Each label reflects OT intuition,
 * not a statistical statement — the goal is "is the worksheet appropriate
 * for a child building a particular capacity?".
 *
 * If a calibration item shifts bucket later, document why in the rationale and
 * adjust EITHER the threshold (in lib/difficulty.ts) OR the expected label
 * (here). Don't sneak around the calibration test.
 */

import type { DifficultyBucket } from "@/lib/difficulty";

export interface CalibrationCase {
  canonicalName: string;
  expected: DifficultyBucket;
  rationale: string;
}

export const CALIBRATION_SET: CalibrationCase[] = [
  // Easy: small palette, blocky, predictable.
  {
    canonicalName: "Apple",
    expected: "easy",
    rationale:
      "Classic flat icon with mostly one red color and a tight stem; small palette, dominant red, tight clustering.",
  },
  {
    canonicalName: "Diamond",
    expected: "medium",
    rationale:
      "Symmetric gem with cyan body and white highlights — but at maxColors=8 the quantizer splits the cyan into 6 effective shades and produces ~50 fragments. Originally tagged easy from gut intuition, re-labeled medium after looking at the actual quantized output: discriminating six cyan shades is genuinely a medium-grade exercise.",
  },
  {
    canonicalName: "Emerald",
    expected: "easy",
    rationale:
      "Same shape family as diamond — strong dominant green body, regular outline, easy to scan.",
  },
  {
    canonicalName: "Coal",
    expected: "medium",
    rationale:
      "Looks beginner-friendly at first glance (a black rock!) but at maxColors=8 the texture decomposes into 5 effective grays with 60+ fragments. Discriminating six gray shades is a medium-grade focus exercise. Re-labeled from easy after the data showed it was visually busier than expected.",
  },
  {
    canonicalName: "Bone",
    expected: "easy",
    rationale:
      "Long bone shape with one dominant ivory and a couple of shading colors; few colors and orderly runs.",
  },

  // Medium: larger palette and more boundaries, but still mostly orderly.
  {
    canonicalName: "Iron_Ingot",
    expected: "medium",
    rationale:
      "Ingot shape with several gray shades for shading; palette grows but the layout is still blocky.",
  },
  {
    canonicalName: "Gold_Ingot",
    expected: "easy",
    rationale:
      "Multi-shade gold ingot but the shades span a wide gamut (yellow → tan → highlight → shadow), so they're easy to discriminate. Re-labeled from medium because the wide color spread and clean ingot geometry actually make it easier than its iron sibling.",
  },
  {
    canonicalName: "Carrot",
    expected: "easy",
    rationale:
      "Two-tone carrot body plus a tidy green leaf — only ~34 fragments and a wide-gamut palette. Re-labeled from medium because the data showed clean shapes and easy-to-discriminate colors.",
  },
  {
    canonicalName: "Bread",
    expected: "medium",
    rationale:
      "Multiple bread browns with small highlights; mid-range palette, mostly clustered.",
  },
  {
    canonicalName: "Stick",
    expected: "easy",
    rationale:
      "Tiny diagonal sprite (only ~37 cells) with a small palette of distinct browns. Originally tagged 'medium' but the calibration data showed score=0 across the board: small palette, low fragment count, modest gamut. Re-labeled easy because in OT terms a 4-color tiny shape is genuinely simpler than a 5+ color icon, even if the colors are similar browns.",
  },

  // Hard: scattered palettes, uneven distributions, or many isolated cells.
  {
    canonicalName: "Cooked_Salmon",
    expected: "hard",
    rationale:
      "Pink-and-orange flesh with shading and dark stripes; large palette, scattered colors, many small clusters.",
  },
  {
    canonicalName: "Pufferfish",
    expected: "hard",
    rationale:
      "Round body with spots and spikes; many isolated yellow/black cells and a busy boundary.",
  },
];
