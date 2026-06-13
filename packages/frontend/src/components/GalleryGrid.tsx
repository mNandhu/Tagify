import React, { useEffect, useMemo, useRef, useState } from "react";
import { ThumbnailTile } from "./ThumbnailTile";
import { VirtualizedGrid } from "./VirtualizedGrid";
import { aspectHeight, rowSpan } from "../lib/masonryLayout";
import type { ImageDoc } from "../lib/imageFilter";

// Upstream items contain width/height; used for masonry layout stabilization.
type ImageDocWithDims = ImageDoc & { width?: number; height?: number };

export function GalleryGrid({
  items,
  selection,
  onToggle,
  onOpen,
  selectionMode,
  getScrollContainer,
}: {
  items: ImageDocWithDims[];
  selection: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  selectionMode: boolean;
  getScrollContainer?: () => HTMLElement | null;
}) {
  // Use virtualization for large datasets; prefer the standard grid otherwise
  // to keep scroll restoration simple.
  const useVirtualization = items.length > 150;

  if (useVirtualization) {
    return (
      <VirtualizedGrid
        items={items}
        selection={selection}
        onToggle={onToggle}
        onOpen={onOpen}
        selectionMode={selectionMode}
        getScrollContainer={getScrollContainer}
        className="min-h-screen"
      />
    );
  }

  return (
    <StandardGrid
      items={items}
      selection={selection}
      onToggle={onToggle}
      onOpen={onOpen}
      selectionMode={selectionMode}
    />
  );
}

function StandardGrid({
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
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 auto-rows-[4px] grid-flow-row-dense"
    >
      {items.map((it, index) => (
        <SpannedTile
          key={it._id}
          it={it}
          index={index}
          selected={selectionMode && selection.has(it._id)}
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

// Wraps a ThumbnailTile in a CSS-grid cell, spanning the rows its aspect ratio
// needs (masonry effect via grid-auto-rows + row span).
const SpannedTile = React.memo(function SpannedTile({
  it,
  index,
  selected,
  selectionMode,
  onToggle,
  onOpen,
  colWidth,
  rowUnit,
  rowGap,
}: {
  it: ImageDocWithDims;
  index: number;
  selected: boolean;
  selectionMode: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  colWidth: number;
  rowUnit: number;
  rowGap: number;
}) {
  const span = useMemo(() => {
    if (colWidth <= 0 || rowUnit <= 0) return 1;
    return rowSpan(aspectHeight(it, colWidth), rowUnit, rowGap);
  }, [it, colWidth, rowUnit, rowGap]);

  const spanClass = useMemo(
    () => `rs-${Math.max(1, Math.min(span, 200))}`,
    [span],
  );

  return (
    <div className={"break-inside-avoid " + spanClass}>
      <ThumbnailTile
        item={it}
        index={index}
        selected={selected}
        selectionMode={selectionMode}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    </div>
  );
});
