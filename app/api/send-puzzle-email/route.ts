// Sends the generated puzzle PDF to a single recipient via Resend.
// Stateless: validates input, applies a per-IP in-memory rate limit, relays bytes,
// stores nothing. PDF is generated client-side; this route only forwards it.
//
// Env:
//   RESEND_API_KEY     required; missing -> friendly 'unavailable' response
//   RESEND_FROM_EMAIL  optional; defaults to puzzles@tradecanny.com
//
// Rate limit: 5 sends/hour/IP. In-memory Map; resets on cold start.
// Acceptable for v1 — niche tool, low abuse surface. Upgrade to Upstash if needed.

import { NextRequest, NextResponse } from "next/server";

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_NOTE_CHARS = 500;
const MAX_LABEL_CHARS = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const SOURCE_FILENAME_PATTERN = /^Invicon_[A-Za-z0-9_()]+\.png$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_FROM = "puzzles@tradecanny.com";

type RateRecord = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateRecord>();

interface SendBody {
  to?: unknown;
  itemLabel?: unknown;
  sourceFilename?: unknown;
  pdfBase64?: unknown;
  note?: unknown;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return jsonError("unavailable", "Email is temporarily unavailable.", 503);
  }

  const ip = clientIp(request);
  const limit = checkRateLimit(ip);
  if (!limit.ok) {
    return jsonError(
      "rate-limited",
      `Too many emails from this device. Try again in ${minutesUntil(limit.resetAt)} minutes.`,
      429,
    );
  }

  let body: SendBody;
  try {
    body = (await request.json()) as SendBody;
  } catch {
    return jsonError("bad-input", "Could not read the request.", 400);
  }

  const validation = validate(body);
  if (!validation.ok) {
    return jsonError("bad-input", validation.message, 400);
  }
  const { to, itemLabel, pdfBase64, note } = validation.value;

  const fromEmail = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM;
  const subject = `Davis Puzzle: ${itemLabel}`;
  const text = buildPlaintextBody(itemLabel, note);
  const filename = `${itemLabel.toLowerCase().replace(/\s+/g, "_")}_puzzle.pdf`;

  let resendModule: typeof import("resend");
  try {
    resendModule = await import("resend");
  } catch {
    return jsonError("unavailable", "Email is temporarily unavailable.", 503);
  }
  const resend = new resendModule.Resend(apiKey);

  try {
    const result = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      text,
      attachments: [
        {
          filename,
          content: pdfBase64,
        },
      ],
    });
    if (result.error) {
      return jsonError(
        "upstream",
        "Couldn't send the email just now. Try again in a moment.",
        502,
      );
    }
    return NextResponse.json(
      { ok: true, id: result.data?.id ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError(
      "upstream",
      "Couldn't send the email just now. Try again in a moment.",
      502,
    );
  }
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { ok: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function validate(
  body: SendBody,
):
  | { ok: false; message: string }
  | {
      ok: true;
      value: {
        to: string;
        itemLabel: string;
        sourceFilename: string;
        pdfBase64: string;
        note: string | null;
      };
    } {
  if (typeof body.to !== "string" || !EMAIL_PATTERN.test(body.to.trim())) {
    return { ok: false, message: "Enter a valid recipient email." };
  }
  const to = body.to.trim();

  if (
    typeof body.itemLabel !== "string" ||
    body.itemLabel.length === 0 ||
    body.itemLabel.length > MAX_LABEL_CHARS
  ) {
    return { ok: false, message: "Item label is missing or too long." };
  }
  const itemLabel = body.itemLabel;

  if (
    typeof body.sourceFilename !== "string" ||
    !SOURCE_FILENAME_PATTERN.test(body.sourceFilename)
  ) {
    return { ok: false, message: "Source filename is invalid." };
  }
  const sourceFilename = body.sourceFilename;

  if (typeof body.pdfBase64 !== "string" || body.pdfBase64.length === 0) {
    return { ok: false, message: "PDF payload is missing." };
  }
  // Strip a possible data URL prefix (e.g. "data:application/pdf;base64,").
  const pdfBase64 = body.pdfBase64.replace(/^data:[^;]+;base64,/, "");
  // Approx decoded size = 3/4 of base64 length.
  const approxBytes = Math.floor((pdfBase64.length * 3) / 4);
  if (approxBytes > MAX_PDF_BYTES) {
    return { ok: false, message: "PDF is too large to email." };
  }

  let note: string | null = null;
  if (body.note != null) {
    if (typeof body.note !== "string" || body.note.length > MAX_NOTE_CHARS) {
      return { ok: false, message: "Note is too long." };
    }
    note = body.note.trim() || null;
  }

  // Cheap header-injection guards.
  if (
    /[\r\n]/.test(to) ||
    /[\r\n]/.test(itemLabel) ||
    (note && /[\r\n]{3,}/.test(note))
  ) {
    return { ok: false, message: "Invalid characters in input." };
  }

  return {
    ok: true,
    value: { to, itemLabel, sourceFilename, pdfBase64, note },
  };
}

function buildPlaintextBody(itemLabel: string, note: string | null): string {
  const lines = [
    `Hi,`,
    ``,
    `Attached is the printable Minecraft Pixel Art Puzzle for "${itemLabel}".`,
    `It is a 4-page Letter PDF (cover, answer key, color-by-number, coordinate coloring).`,
    ``,
  ];
  if (note) {
    lines.push(`Note from the sender:`, note, ``);
  }
  lines.push(
    `Generated by the Davis Puzzle web app.`,
    `Unofficial fan-made tool. Textures (c) Mojang, sourced from minecraft.wiki.`,
  );
  return lines.join("\n");
}

function checkRateLimit(ip: string): { ok: true } | { ok: false; resetAt: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || record.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (record.count >= RATE_LIMIT_MAX) {
    return { ok: false, resetAt: record.resetAt };
  }
  record.count += 1;
  return { ok: true };
}

function minutesUntil(timestamp: number): number {
  return Math.max(1, Math.ceil((timestamp - Date.now()) / 60000));
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
