import { useState, useEffect, useRef, useMemo } from "react";
import { ThumbnailTile } from "./ThumbnailTile";
import {
  columnWidth,
  estimateItemHeight,
  gridColumns,
} from "../lib/masonryLayout";
import type { ImageDoc } from "../lib/imageFilter";

type ImageDocWithDims = ImageDoc & { width?: number; height?: number };

// One positioned tile in the masonry layout (pixel coords within the wrapper).
type Tile = {
  item: ImageDocWithDims;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

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

  // Column-masonry layout: place each item in the currently-shortest column so
  // shorter items pack up and tiles below rise to fill gaps (Pinterest-style),
  // matching the CSS-grid StandardGrid. A fixed-row layout would leave empty
  // space under the short items in a tall row.
  const { tiles, columns, totalHeight } = useMemo(() => {
    if (!colWidth || cols === 0) {
      return {
        tiles: [] as Tile[],
        columns: [] as Tile[][],
        totalHeight: 0,
      };
    }

    const colHeights = new Array(cols).fill(0);
    const colTiles: Tile[][] = Array.from({ length: cols }, () => []);
    const allTiles: Tile[] = [];

    for (let i = 0; i < items.length; i++) {
      // Shortest column wins (ties go left).
      let col = 0;
      for (let c = 1; c < cols; c++) {
        if (colHeights[c] < colHeights[col]) col = c;
      }
      const h = estimateItemHeight(items[i], colWidth);
      const tile: Tile = {
        item: items[i],
        index: i,
        x: col * (colWidth + GAP),
        y: colHeights[col],
        w: colWidth,
        h,
      };
      colHeights[col] += h + GAP;
      colTiles[col].push(tile);
      allTiles.push(tile);
    }

    return {
      tiles: allTiles,
      columns: colTiles,
      totalHeight: Math.max(0, ...colHeights),
    };
  }, [items, colWidth, cols]);

  // First index in a column whose tile *bottom* is >= y (column is sorted by y
  // ascending and tiles don't overlap, so this is monotonic).
  const lowerBoundByBottom = (column: Tile[], y: number) => {
    let lo = 0;
    let hi = column.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (column[mid].y + column[mid].h < y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // Visible tiles: per-column binary-search slice of the viewport window.
  const visibleTiles = useMemo(() => {
    if (!tiles.length) return [];
    const viewportTop = Math.max(0, scrollTop - wrapperTop);
    const viewportBottom = viewportTop + viewportHeight;

    // Overscan to reduce pop-in. Must exceed the tile's load-ahead rootMargin
    // (~1200px) so tiles mount before they start loading, letting thumbs decode
    // before they scroll into view.
    const overscanPx = 1600;
    const startY = Math.max(0, viewportTop - overscanPx);
    const endY = viewportBottom + overscanPx;

    const out: Tile[] = [];
    for (const column of columns) {
      // Start at the first tile reaching into the window…
      for (let i = lowerBoundByBottom(column, startY); i < column.length; i++) {
        // …and stop once a tile starts past the window (rest are lower still).
        if (column[i].y > endY) break;
        out.push(column[i]);
      }
    }
    return out;
  }, [tiles, columns, scrollTop, viewportHeight, wrapperTop]);

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
        {/* Render only visible tiles, absolutely positioned. */}
        {visibleTiles.map((tile) => (
          <div
            key={tile.item._id}
            className="absolute will-change-transform"
            style={{
              transform: `translate(${tile.x}px, ${tile.y}px)`,
              width: `${tile.w}px`,
              height: `${tile.h}px`,
            }}
          >
            <ThumbnailTile
              item={tile.item}
              index={tile.index}
              selected={selectionMode && selection.has(tile.item._id)}
              selectionMode={selectionMode}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
