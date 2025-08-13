import React from "react";
import { ImageThumbnail } from "./ImageThumbnail";

type ImageDoc = { _id: string; thumb_rel?: string; path: string };

export function GalleryGrid({
  items,
  selection,
  onToggle,
  onOpen,
  selectionMode,
}: {
  items: ImageDoc[];
  selection: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  selectionMode: boolean;
}) {
  return (
    <div className="columns-2 md:columns-3 lg:columns-4 gap-3 [column-fill:_balance]">
      {items.map((it) => (
        <div key={it._id} className="mb-3 break-inside-avoid">
          <div className="relative group">
            <ImageThumbnail
              src={it.thumb_rel ? `/api/thumbs/${it.thumb_rel}` : ""}
              alt={it.path}
              selected={selection.has(it._id)}
              onClick={() =>
                selectionMode ? onToggle(it._id) : onOpen(it._id)
              }
            />
            {selectionMode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(it._id);
                }}
                aria-label={selection.has(it._id) ? "Deselect" : "Select"}
                className="absolute top-2 right-2 w-6 h-6 rounded border border-white/60 bg-black/40 flex items-center justify-center"
              >
                {selection.has(it._id) ? (
                  <span className="w-3 h-3 bg-purple-500 block rounded-sm" />
                ) : (
                  <span className="w-3 h-3 block rounded-sm" />
                )}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
