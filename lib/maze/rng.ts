// Tiny seedable PRNG (sfc32) plus a base32 seed generator.
// Used by the maze generator so a printed seed reproduces a maze byte-for-byte.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function hashSeedToState(seed: string): [number, number, number, number] {
  // FNV-1a-ish 32-bit hash, fanned out into four state words for sfc32.
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  let h3 = 0x9e3779b9;
  let h4 = 0x7f4a7c15;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x85ebca6b);
    h3 = Math.imul(h3 ^ ch, 0xc2b2ae35);
    h4 = Math.imul(h4 ^ ch, 0x27d4eb2f);
  }
  // Avoid the all-zero state which would lock sfc32 to zero output.
  if ((h1 | h2 | h3 | h4) === 0) h1 = 1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function makeRng(seed: string): {
  next: () => number;
  pickInt: (n: number) => number;
  shuffle: <T>(arr: T[]) => T[];
} {
  const state = hashSeedToState(seed);
  let [a, b, c, d] = state;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const sum = (t + d) | 0;
    c = (c + sum) | 0;
    return (sum >>> 0) / 4294967296;
  };
  const pickInt = (n: number): number => Math.floor(next() * n);
  const shuffle = <T>(arr: T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = pickInt(i + 1);
      const tmp = out[i];
      const swap = out[j];
      if (tmp === undefined || swap === undefined) continue;
      out[i] = swap;
      out[j] = tmp;
    }
    return out;
  };
  return { next, pickInt, shuffle };
}

export function generateSeed(): string {
  // 6-char base32 from crypto if available, else Math.random fallback.
  const bytes = new Uint8Array(6);
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined" && "crypto" in globalThis
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    out += BASE32_ALPHABET.charAt(byte & 31);
  }
  return out;
}
