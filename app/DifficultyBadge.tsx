import { type DifficultyBucket } from "@/lib/difficulty";

interface DifficultyBadgeProps {
  bucket: DifficultyBucket;
  explanation?: string;
  size?: "sm" | "md";
}

const BUCKET_STYLE: Record<
  DifficultyBucket,
  { label: string; icon: string; bg: string; fg: string; border: string }
> = {
  easy: {
    label: "Easy",
    icon: "●",
    bg: "#e3f5ec",
    fg: "#1d6b50",
    border: "#a8d6c1",
  },
  medium: {
    label: "Medium",
    icon: "●●",
    bg: "#fff5e0",
    fg: "#7a4f10",
    border: "#e8c98a",
  },
  hard: {
    label: "Hard",
    icon: "●●●",
    bg: "#fbe7e3",
    fg: "#9a322a",
    border: "#e7a89f",
  },
};

export function DifficultyBadge({
  bucket,
  explanation,
  size = "md",
}: DifficultyBadgeProps) {
  const style = BUCKET_STYLE[bucket];
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs";
  return (
    <span
      role="status"
      aria-label={
        explanation
          ? `Difficulty: ${style.label}. ${explanation}`
          : `Difficulty: ${style.label}`
      }
      title={explanation ?? `Difficulty: ${style.label}`}
      className={`inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wide ${padding}`}
      style={{
        backgroundColor: style.bg,
        color: style.fg,
        borderColor: style.border,
      }}
    >
      <span aria-hidden="true">{style.icon}</span>
      <span>{style.label}</span>
    </span>
  );
}
