import React, { useState, useEffect, useRef, useMemo } from "react";
import { ImageThumbnail } from "./ImageThumbnail";
import { resolveMediaUrl } from "../lib/media";

type ImageDoc = { _id: string; thumb_rel?: string; path: string };
type ImageDocWithDims = ImageDoc & { width?: number; height?: number };

interface VirtualizedGridProps {
  items: ImageDocWithDims[];
  selection: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  selectionMode: boolean;
  className?: string;
  getScrollContainer?: () => HTMLElement | null;
}

// Estimate item height based on aspect ratio for virtualization
function estimateItemHeight(item: ImageDocWithDims, colWidth: number): number {
  const w = item.width || 1;
  const h = item.height || 1;
  const aspectRatio = h / w;
  return Math.max(150, colWidth * aspectRatio); // Minimum 150px height
}

export function VirtualizedGrid({
  items,
  selection,
  onToggle,
  onOpen,
  selectionMode,
  className,
  getScrollContainer,
}: VirtualizedGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const virtualContainerRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const [wrapperTop, setWrapperTop] = useState(0);
  const [colWidth, setColWidth] = useState(0);
  const [cols, setCols] = useState(2);

  // Tailwind breakpoints: md=768px, lg=1024px
  const computeCols = (w: number) => {
    if (w >= 1024) return 4;
    if (w >= 768) return 3;
    return 2;
  };

  const recomputeLayout = (scrollEl: HTMLElement) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const w = wrapper.clientWidth;
    const nextCols = computeCols(w);
    setCols(nextCols);

    const gap = 12; // gap-3 (0.75rem)
    const nextColWidth =
      nextCols > 0 ? (w - gap * (nextCols - 1)) / nextCols : w;
    setColWidth(nextColWidth);

    setViewportHeight(scrollEl.clientHeight || 600);
    // wrapper's top in scroll content coordinates
    const scrollRect = scrollEl.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const top = wrapperRect.top - scrollRect.top + scrollEl.scrollTop;
    setWrapperTop(top);
  };

  // Track scrollTop from the *outer* scroll container.
  useEffect(() => {
    const scrollEl = getScrollContainer?.();
    const wrapper = wrapperRef.current;
    if (!scrollEl || !wrapper) return;

    const handleScroll = () => {
      setScrollTop(scrollEl.scrollTop);
    };

    // Initial
    recomputeLayout(scrollEl);
    setScrollTop(scrollEl.scrollTop);

    // Observe wrapper resize for column changes
    const ro = new ResizeObserver(() => recomputeLayout(scrollEl));
    ro.observe(wrapper);

    // Also keep viewport height + wrapperTop reasonably fresh
    const roScroll = new ResizeObserver(() => recomputeLayout(scrollEl));
    roScroll.observe(scrollEl);

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      ro.disconnect();
      roScroll.disconnect();
      scrollEl.removeEventListener("scroll", handleScroll);
    };
  }, [getScrollContainer]);

  // Create virtual rows from items
  const { virtualRows, totalHeight } = useMemo(() => {
    if (!colWidth || cols === 0) return { virtualRows: [], totalHeight: 0 };

    const rows: Array<{
      items: Array<{ item: ImageDocWithDims; index: number }>;
      height: number;
      y: number;
    }> = [];
    let currentY = 0;

    for (let i = 0; i < items.length; i += cols) {
      const rowItems: Array<{ item: ImageDocWithDims; index: number }> = [];
      let maxHeight = 150; // Minimum row height

      for (let j = 0; j < cols && i + j < items.length; j++) {
        const item = items[i + j];
        const height = estimateItemHeight(item, colWidth);
        maxHeight = Math.max(maxHeight, height);
        rowItems.push({ item, index: i + j });
      }

      const rowHeight = maxHeight + 12; // Add gap
      rows.push({
        items: rowItems,
        height: rowHeight,
        y: currentY,
      });

      currentY += rowHeight;
    }

    return { virtualRows: rows, totalHeight: currentY };
  }, [items, colWidth, cols]);

  const lowerBoundByY = (rows: Array<{ y: number }>, y: number) => {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].y < y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // Calculate visible rows
  const visibleRows = useMemo(() => {
    // Translate scroll container viewport to wrapper-local coordinates.
    const viewportTop = Math.max(0, scrollTop - wrapperTop);
    const viewportBottom = viewportTop + viewportHeight;

    // Overscan to reduce pop-in while scrolling.
    const overscanPx = 800;
    const startY = Math.max(0, viewportTop - overscanPx);
    const endY = viewportBottom + overscanPx;

    if (!virtualRows.length) return [];

    // Slice rows using binary search on row.y (monotonic)
    const startIdx = Math.max(0, lowerBoundByY(virtualRows, startY) - 1);
    const endExclusive = Math.min(
      virtualRows.length,
      lowerBoundByY(virtualRows, endY) + 2
    );

    return virtualRows.slice(startIdx, endExclusive);
  }, [virtualRows, scrollTop, viewportHeight, wrapperTop]);

  // Apply total height without using inline styles
  useEffect(() => {
    const el = virtualContainerRef.current;
    if (!el) return;
    el.style.height = `${totalHeight}px`;
  }, [totalHeight]);

  return (
    <div ref={wrapperRef} className={`relative ${className || ""}`}>
      {/* Virtual container with total height */}
      <div ref={virtualContainerRef} className="relative">
        {/* Render only visible rows */}
        {visibleRows.map((row) => (
          <VirtualRow
            key={`row-${row.y}`}
            y={row.y}
            height={row.height - 12}
            cols={cols}
          >
            {row.items.map(({ item, index }) => (
              <VirtualThumbnailItem
                key={item._id}
                item={item}
                index={index}
                selected={selectionMode && selection.has(item._id)}
                selectionMode={selectionMode}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </VirtualRow>
        ))}
      </div>
    </div>
  );
}

function VirtualRow({
  y,
  height,
  cols,
  children,
}: {
  y: number;
  height: number;
  cols: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Position without JSX inline styles
    el.style.transform = `translateY(${y}px)`;
    el.style.height = `${height}px`;
  }, [y, height]);

  return (
    <div
      ref={ref}
      className={`absolute left-0 right-0 grid gap-3 will-change-transform ${
        cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-4"
      }`}
    >
      {children}
    </div>
  );
}

const VirtualThumbnailItem = React.memo(function VirtualThumbnailItem({
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
  const [thumbUrl, setThumbUrl] = useState<string>(
    `/api/images/${encodeURIComponent(item._id)}/thumb`
  );

  useEffect(() => {
    let mounted = true;
    const ep = `/api/images/${encodeURIComponent(item._id)}/thumb`;

    resolveMediaUrl(ep)
      .then((u) => {
        if (mounted) setThumbUrl(u);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [item._id]);

  return (
    <div className="relative group h-full">
      <ImageThumbnail
        src={thumbUrl}
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
