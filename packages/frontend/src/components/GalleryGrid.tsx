import React, { useEffect, useMemo, useRef, useState } from "react";
import { ImageThumbnail } from "./ImageThumbnail";
import { resolveMediaUrl } from "../lib/media";

type ImageDoc = { _id: string; thumb_rel?: string; path: string };
// Upstream items from API contain width/height; extend locally to use for layout stabilization if present
type ImageDocWithDims = ImageDoc & { width?: number; height?: number };

export function GalleryGrid({
  items,
  selection,
  onToggle,
  onOpen,
  selectionMode,
}: {
  items: ImageDocWithDims[];
  selection: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  selectionMode: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [colWidth, setColWidth] = useState<number>(0);
  const [rowUnit, setRowUnit] = useState<number>(4); // px, matches auto-rows-[4px]
  const [rowGap, setRowGap] = useState<number>(12); // px, from computed gap

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const cs = getComputedStyle(el);
      // Determine number of columns from computed gridTemplateColumns
      const gtc = cs.gridTemplateColumns;
      const cols = gtc ? gtc.split(" ").length : 2;
      const colGap = parseFloat(cs.columnGap || "12");
      const width = el.clientWidth;
      const trackWidth =
        cols > 0 ? (width - colGap * (cols - 1)) / cols : width;
      setColWidth(trackWidth);
      const gar = cs.gridAutoRows || "4px";
      const ru = parseFloat(gar) || 4;
      setRowUnit(ru);
      const rGap = parseFloat(cs.rowGap || cs.gap || "12");
      setRowGap(rGap || 12);
    };
    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 auto-rows-[4px] grid-flow-row-dense"
    >
      {items.map((it, index) => (
        <ThumbnailItem
          key={it._id}
          it={it}
          index={index}
          selection={selection}
          selectionMode={selectionMode}
          onOpen={onOpen}
          onToggle={onToggle}
          colWidth={colWidth}
          rowUnit={rowUnit}
          rowGap={rowGap}
        />
      ))}
    </div>
  );
}

function ThumbnailItem({
  it,
  index,
  selection,
  selectionMode,
  onToggle,
  onOpen,
  colWidth,
  rowUnit,
  rowGap,
}: {
  it: ImageDocWithDims;
  index: number;
  selection: Set<string>;
  selectionMode: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  colWidth: number;
  rowUnit: number;
  rowGap: number;
}) {
  const [thumbUrl, setThumbUrl] = useState<string>(
    `/api/images/${encodeURIComponent(it._id)}/thumb`
  );
  const [rowSpan, setRowSpan] = useState<number>(1);
  useEffect(() => {
    let mounted = true;
    const ep = `/api/images/${encodeURIComponent(it._id)}/thumb`;
    resolveMediaUrl(ep)
      .then((u) => {
        if (mounted) setThumbUrl(u);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [it._id]);

  // Compute grid row span based on known aspect ratio, column width, and row gap
  useEffect(() => {
    const w = it.width || 1;
    const h = it.height || 1;
    if (colWidth > 0 && rowUnit > 0) {
      const pxHeight = (h / w) * colWidth;
      // Compute rows so N*rowUnit + (N-1)*rowGap >= pxHeight
      const rows = Math.max(
        1,
        Math.ceil((pxHeight + rowGap) / (rowUnit + rowGap))
      );
      setRowSpan(rows);
    } else {
      setRowSpan(1);
    }
  }, [it.width, it.height, colWidth, rowUnit, rowGap]);

  const spanClass = useMemo(
    () => `rs-${Math.max(1, Math.min(rowSpan, 200))}`,
    [rowSpan]
  );

  return (
    <div className={"break-inside-avoid " + spanClass}>
      <div className="relative group h-full">
        <ImageThumbnail
          src={thumbUrl}
          alt={it.path}
          width={it.width}
          height={it.height}
          selected={selectionMode && selection.has(it._id)}
          onClick={() => (selectionMode ? onToggle(it._id) : onOpen(it._id))}
          priority={index < 12} // First 12 items get high priority
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
  );
}
