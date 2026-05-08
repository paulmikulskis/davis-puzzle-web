import { canonicalize } from "@/lib/canonicalize";
import { PuzzleError } from "@/lib/errors";

const ARTICLE_ICON_RE =
  /\/images\/(?:thumb\/[^/]+\/[^/]+\/)?(Invicon_[A-Za-z0-9_]+\.png)/g;

export interface TextureFetchResult {
  canonical: string;
  sourceFilename: string;
  bytes: Uint8Array;
  blob: Blob;
  blobUrl: string;
  contentType: string;
}

interface ImageHit {
  filename: string;
  bytes: Uint8Array;
  blob: Blob;
  blobUrl: string;
  contentType: string;
}

export async function fetchTexture(itemNameOrCanonical: string): Promise<TextureFetchResult> {
  const canonical = canonicalize(itemNameOrCanonical);
  if (!canonical) {
    throw new PuzzleError("bad-input", "Type a Minecraft item name first.");
  }

  const candidates = [
    `Invicon_${canonical}.png`,
    `Invicon_Raw_${canonical}.png`,
    `Invicon_Cooked_${canonical}.png`,
  ];

  for (const filename of candidates) {
    const hit = await fetchImage(filename);
    if (hit) {
      return { canonical, sourceFilename: hit.filename, ...hit };
    }
  }

  const scrapedFilename = await scrapeArticleForIcon(canonical);
  const scrapedHit = await fetchImage(scrapedFilename);
  if (!scrapedHit) {
    throw new PuzzleError(
      "not-found",
      "The wiki article referenced an inventory icon, but the image was not found.",
    );
  }

  return { canonical, sourceFilename: scrapedHit.filename, ...scrapedHit };
}

async function fetchImage(filename: string): Promise<ImageHit | null> {
  const response = await fetch(
    `/api/wiki?kind=image&path=${encodeURIComponent(filename)}`,
    { cache: "no-store" },
  ).catch((error: unknown) => {
    throw new PuzzleError("network", "Could not reach the wiki image proxy.", error);
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new PuzzleError(
      response.status === 400 ? "not-found" : "network",
      `The wiki image request failed with HTTP ${response.status}.`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "image/png";
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const blob = new Blob([buffer], { type: contentType });

  return {
    filename,
    bytes,
    blob,
    blobUrl: URL.createObjectURL(blob),
    contentType,
  };
}

async function scrapeArticleForIcon(canonical: string): Promise<string> {
  const response = await fetch(
    `/api/wiki?kind=article&path=${encodeURIComponent(canonical)}`,
    { cache: "no-store" },
  ).catch((error: unknown) => {
    throw new PuzzleError("network", "Could not reach the wiki article proxy.", error);
  });

  if (response.status === 404) {
    throw new PuzzleError(
      "not-found",
      "Could not find that item article on minecraft.wiki.",
    );
  }

  if (!response.ok) {
    throw new PuzzleError(
      response.status === 400 ? "not-found" : "network",
      `The wiki article request failed with HTTP ${response.status}.`,
    );
  }

  const html = await response.text();
  const canonicalToken = canonical.toLowerCase();
  const matches = Array.from(html.matchAll(ARTICLE_ICON_RE), (match, index) => ({
    filename: match[1],
    index,
  }));

  if (matches.length === 0) {
    throw new PuzzleError(
      "not-found",
      "No Minecraft inventory icon was found on that wiki article.",
    );
  }

  matches.sort((a, b) => {
    const aHasToken = a.filename.toLowerCase().includes(canonicalToken) ? 1 : 0;
    const bHasToken = b.filename.toLowerCase().includes(canonicalToken) ? 1 : 0;

    return (
      bHasToken - aHasToken ||
      a.filename.length - b.filename.length ||
      a.index - b.index
    );
  });

  return matches[0].filename;
}
