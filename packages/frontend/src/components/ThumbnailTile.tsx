import React from "react";
import { ImageThumbnail } from "./ImageThumbnail";
import type { ImageDoc } from "../lib/imageFilter";

type ImageDocWithDims = ImageDoc & { width?: number; height?: number };

/**
 * One gallery tile: resolves the thumbnail URL (supports pre-signed URL mode),
 * renders the image, and overlays the selection checkbox in selection mode.
 *
 * Shared by both the CSS-grid gallery and the virtualized gallery — previously
 * duplicated as ThumbnailItem / VirtualThumbnailItem. Each grid wraps this with
 * its own positioning (row-span vs absolute row).
 */
export const ThumbnailTile = React.memo(function ThumbnailTile({
  item,
  index,
  selected,
  selectionMode,
  onToggle,
  onOpen,
}: {
  item: ImageDocWithDims;
  index: number;
  selected: boolean;
  selectionMode: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  // Endpoint only — ImageThumbnail resolves the real media URL lazily, once it
  // decides to load (priority or in-viewport), so offscreen tiles don't each
  // fire a resolve request up-front (matters in presigned-`url` mode).
  const thumbEndpoint = `/api/images/${encodeURIComponent(item._id)}/thumb`;

  return (
    <div className="relative group h-full">
      <ImageThumbnail
        src={thumbEndpoint}
        alt={item.path}
        width={item.width}
        height={item.height}
        selected={selected}
        onClick={() => (selectionMode ? onToggle(item._id) : onOpen(item._id))}
        priority={index < 12} // First 12 items get high priority
      />
      {selectionMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item._id);
          }}
          aria-label={selected ? "Deselect" : "Select"}
          className="absolute top-2 right-2 w-6 h-6 rounded border border-white/60 bg-black/40 flex items-center justify-center"
        >
          {selected ? (
            <span className="w-3 h-3 bg-purple-500 block rounded-sm" />
          ) : (
            <span className="w-3 h-3 block rounded-sm" />
          )}
        </button>
      )}
    </div>
  );
});
