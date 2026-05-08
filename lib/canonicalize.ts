export function canonicalize(name: string): string {
  return name
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("_");
}

export function humanize(canonical: string): string {
  return canonical.replaceAll("_", " ");
}

export function puzzleFilename(canonical: string): string {
  return `${canonical.toLowerCase()}_puzzle.pdf`;
}
