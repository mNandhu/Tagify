import { cn } from "../lib/cn";
import React, { useState } from "react";

export function ImageThumbnail({
  src,
  selected,
  onClick,
  alt,
  width,
  height,
}: {
  src: string;
  selected?: boolean;
  onClick?: () => void;
  alt?: string;
  width?: number;
  height?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      className={cn(
        "group relative w-full overflow-hidden rounded bg-neutral-900",
        selected && "ring-2 ring-purple-500"
      )}
      onClick={onClick}
    >
      {/* Skeleton shimmer (only while loading) */}
      {!loaded && (
        <div
          className={cn(
            "absolute inset-0 rounded bg-neutral-800/60 animate-pulse",
            "motion-reduce:animate-none"
          )}
          aria-hidden="true"
        />
      )}
      <img
        src={src}
        alt={alt}
        decoding="async"
        fetchPriority="low"
        width={width}
        height={height}
        className={cn(
          "h-auto w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]",
          "transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0"
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        loading="lazy"
      />
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/10" />
    </button>
  );
}
