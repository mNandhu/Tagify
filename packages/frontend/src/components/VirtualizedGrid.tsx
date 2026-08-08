import { useState, useEffect, useRef, useMemo } from "react";
import { ThumbnailTile } from "./ThumbnailTile";
import {
  columnWidth,
  gridColumns,
  packColumns,
  visibleSlice,
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
  focusedIndex?: number;
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
  focusedIndex = -1,
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

  const { tiles, columns, totalHeight } = useMemo(
    () => packColumns(items, cols, colWidth, GAP),
    [items, colWidth, cols]
  );

  const visibleTiles = useMemo(
    () =>
      visibleSlice(columns, Math.max(0, scrollTop - wrapperTop), viewportHeight),
    [columns, scrollTop, viewportHeight, wrapperTop]
  );

  // Apply total height without using inline styles
  useEffect(() => {
    const el = virtualContainerRef.current;
    if (!el) return;
    el.style.height = `${totalHeight}px`;
  }, [totalHeight]);

  // Keyboard-focused tile may be outside the rendered/visible window; scroll the
  // container so it shows (the layout knows every tile's y).
  useEffect(() => {
    if (focusedIndex < 0) return;
    const scrollEl = getScrollContainer?.();
    const tile = tiles[focusedIndex];
    if (!scrollEl || !tile) return;
    const top = wrapperTop + tile.y;
    const bottom = top + tile.h;
    const viewTop = scrollEl.scrollTop;
    const viewBottom = viewTop + scrollEl.clientHeight;
    if (top < viewTop) {
      scrollEl.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
    } else if (bottom > viewBottom) {
      scrollEl.scrollTo({
        top: bottom - scrollEl.clientHeight + 12,
        behavior: "smooth",
      });
    }
  }, [focusedIndex, tiles, wrapperTop, getScrollContainer]);

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
              getRoot={getScrollContainer}
              eager
              focused={tile.index === focusedIndex}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
