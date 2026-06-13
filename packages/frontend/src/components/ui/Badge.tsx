import React from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "brand" | "success" | "danger" | "warning";

const TONES: Record<Tone, string> = {
  neutral: "bg-neutral-800 border-neutral-700 text-neutral-300",
  brand: "bg-purple-900/30 border-purple-700 text-purple-200",
  success: "bg-emerald-900/30 border-emerald-700 text-emerald-200",
  danger: "bg-red-900/30 border-red-700 text-red-200",
  warning: "bg-amber-900/25 border-amber-700 text-amber-200",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
