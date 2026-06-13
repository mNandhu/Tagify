import React, { useState, useEffect, useRef, useMemo } from "react";
import { ThumbnailTile } from "./ThumbnailTile";
import {
  columnWidth,
  estimateItemHeight,
  gridColumns,
} from "../lib/masonryLayout";
import type { ImageDoc } from "../lib/imageFilter";

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

const GAP = 12; // gap-3 (0.75rem)

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

  const recomputeLayout = (scrollEl: HTMLElement) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const w = wrapper.clientWidth;
    const nextCols = gridColumns(w);
    setCols(nextCols);
    setColWidth(columnWidth(w, nextCols, GAP));

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

    // Coalesce scroll events to one state update per animation frame.
    let rafId = 0;
    const handleScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        setScrollTop(scrollEl.scrollTop);
      });
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
      if (rafId) cancelAnimationFrame(rafId);
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
        maxHeight = Math.max(maxHeight, estimateItemHeight(item, colWidth));
        rowItems.push({ item, index: i + j });
      }

      const rowHeight = maxHeight + GAP;
      rows.push({
        items: rowItems,
        height: rowHeight,
        y: currentY,
      });

      currentY += rowHeight;
    }

    return { virtualRows: rows, totalHeight: currentY };
  }, [items, colWidth, cols]);

  // Binary search to find the first row with y >= targetY.
  // Precondition: rows array is sorted by y in ascending order (guaranteed by row construction loop above).
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
      lowerBoundByY(virtualRows, endY) + 2,
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
            height={row.height - GAP}
            cols={cols}
          >
            {row.items.map(({ item, index }) => (
              <ThumbnailTile
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
  return (
    <div
      className={`absolute left-0 right-0 grid gap-3 will-change-transform ${
        cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-4"
      }`}
      style={{ transform: `translateY(${y}px)`, height: `${height}px` }}
    >
      {children}
    </div>
  );
}
