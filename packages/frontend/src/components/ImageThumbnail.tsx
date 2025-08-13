import { cn } from "../lib/cn";
import React from "react";

export function ImageThumbnail({
  src,
  selected,
  onClick,
  alt,
}: {
  src: string;
  selected?: boolean;
  onClick?: () => void;
  alt?: string;
}) {
  return (
    <button
      className={cn(
        "group relative w-full overflow-hidden rounded",
        selected && "ring-2 ring-purple-500"
      )}
      onClick={onClick}
    >
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        loading="lazy"
      />
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/10" />
    </button>
  );
}
