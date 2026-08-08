import { useState, useEffect, useRef, useMemo } from "react";
import { ThumbnailTile } from "./ThumbnailTile";
import {
  columnWidth,
  gapForDensity,
  gridColumns,
  packColumns,
  visibleSlice,
  DEFAULT_DENSITY,
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
  /** Index into DENSITY_STEPS — how many columns to pack in. */
  density?: number;
  /** Hold quarantined tiles back visually. Off in the quarantined view, where
   * every tile is quarantined and dimming them all helps nobody. */
  dimQuarantined?: boolean;
}

/** Longest entrance stagger, so a 200-item page doesn't trickle in for 4s. */
const MAX_STAGGER_MS = 240;
/** Per-tile stagger step. */
const STAGGER_STEP_MS = 18;
/** How long newly-appended tiles keep their entrance animation. */
const ENTRANCE_WINDOW_MS = 900;

/**
 * The gallery grid.
 *
 * Always virtualized. There used to be a second, CSS-grid implementation that
 * took over below 150 items, which meant the grid swapped implementations
 * mid-scroll on the first page boundary — a full remount from row-spans to
 * absolute positioning. The two also disagreed about column count (viewport
 * breakpoints vs container width), so keyboard row-jumps were wrong in one of
 * them. One implementation, one `gridColumns`, no swap.
 */
export function VirtualizedGrid({
  items,
  selection,
  onToggle,
  onOpen,
  selectionMode,
  className,
  getScrollContainer,
  focusedIndex = -1,
  density = DEFAULT_DENSITY,
  dimQuarantined = true,
}: VirtualizedGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const virtualContainerRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const [wrapperTop, setWrapperTop] = useState(0);
  // Only the *measurement* is state. Columns, column width and gutter are all
  // derived from it and the density in one place below.
  //
  // They used to be split: `gap` was computed inline from the density prop
  // while `cols`/`colWidth` were set by an effect. On a zoom step React
  // rendered once with the new gap against the previous width and count, so
  // every `+`/`-` press packed one frame of visibly wrong layout before the
  // effect landed. Deriving them together makes that state unrepresentable.
  const [wrapperWidth, setWrapperWidth] = useState(0);

  const { cols, colWidth, gap } = useMemo(() => {
    const c = gridColumns(wrapperWidth, density);
    const g = gapForDensity(density);
    return { cols: c, colWidth: columnWidth(wrapperWidth, c, g), gap: g };
  }, [wrapperWidth, density]);

  const recomputeLayout = (scrollEl: HTMLElement) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    setWrapperWidth(wrapper.clientWidth);
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
    () => packColumns(items, cols, colWidth, gap),
    [items, colWidth, cols, gap]
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

  // Entrance animation for tiles a page-fetch just appended.
  //
  // Keyed on "index >= the count before this page arrived" rather than on
  // mount, because virtualization unmounts and remounts tiles constantly while
  // scrolling — animating on mount would make the grid flicker every time you
  // scrolled back up. The window closes on a timer so a tile that scrolls away
  // and returns comes back without re-animating.
  const knownCountRef = useRef(0);
  const [entranceFrom, setEntranceFrom] = useState<number>(Infinity);
  useEffect(() => {
    if (items.length > knownCountRef.current) {
      setEntranceFrom(knownCountRef.current);
    } else if (items.length < knownCountRef.current) {
      // Images were removed (a bulk quarantine drops them from the cache).
      // Nothing here is new, so nothing should animate — setting 0 would fade
      // the entire visible grid back in every time a batch completes.
      setEntranceFrom(Infinity);
    }
    knownCountRef.current = items.length;
  }, [items.length]);

  useEffect(() => {
    if (entranceFrom === Infinity) return;
    const t = setTimeout(() => setEntranceFrom(Infinity), ENTRANCE_WINDOW_MS);
    return () => clearTimeout(t);
  }, [entranceFrom]);

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
        {visibleTiles.map((tile) => {
          const entering = tile.index >= entranceFrom;
          return (
            <div
              key={tile.item._id}
              className={
                entering ? "absolute motion-safe:animate-fade-in" : "absolute"
              }
              style={{
                // No `will-change: transform` here. It used to sit on every
                // visible tile permanently, promoting each one to its own
                // compositor layer — a real memory cost on a dense grid, for an
                // element whose transform is set once and never animated.
                transform: `translate(${tile.x}px, ${tile.y}px)`,
                width: `${tile.w}px`,
                height: `${tile.h}px`,
                animationDelay: entering
                  ? `${Math.min(
                      MAX_STAGGER_MS,
                      (tile.index - entranceFrom) * STAGGER_STEP_MS
                    )}ms`
                  : undefined,
              }}
            >
              <ThumbnailTile
                item={tile.item}
                index={tile.index}
                selected={selectionMode && selection.has(tile.item._id)}
                selectionMode={selectionMode}
                dimQuarantined={dimQuarantined}
                onOpen={onOpen}
                onToggle={onToggle}
                getRoot={getScrollContainer}
                eager
                focused={tile.index === focusedIndex}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
