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
}: VirtualizedGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const [colWidth, setColWidth] = useState(0);
  const [cols, setCols] = useState(2);

  // Calculate columns and width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const cs = getComputedStyle(el);
      const gtc = cs.gridTemplateColumns;
      const detectedCols = gtc ? gtc.split(" ").length : 2;
      setCols(detectedCols);
      
      const colGap = parseFloat(cs.columnGap || "12");
      const width = el.clientWidth;
      const trackWidth = detectedCols > 0 ? (width - colGap * (detectedCols - 1)) / detectedCols : width;
      setColWidth(trackWidth);
    };

    compute();
    const ro = new ResizeObserver(() => {
      compute();
      setContainerHeight(el.clientHeight);
    });
    ro.observe(el);
    
    const handleScroll = () => {
      setScrollTop(el.scrollTop);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Create virtual rows from items
  const virtualRows = useMemo(() => {
    if (!colWidth || cols === 0) return [];
    
    const rows: Array<{ items: Array<{ item: ImageDocWithDims; index: number }>, height: number, y: number }> = [];
    let currentY = 0;
    
    for (let i = 0; i < items.length; i += cols) {
      const rowItems = [];
      let maxHeight = 150; // Minimum row height
      
      for (let j = 0; j < cols && i + j < items.length; j++) {
        const item = items[i + j];
        const height = estimateItemHeight(item, colWidth);
        maxHeight = Math.max(maxHeight, height);
        rowItems.push({ item, index: i + j });
      }
      
      rows.push({
        items: rowItems,
        height: maxHeight + 12, // Add gap
        y: currentY
      });
      
      currentY += maxHeight + 12;
    }
    
    return rows;
  }, [items, colWidth, cols]);

  // Calculate visible rows  
  const visibleRows = useMemo(() => {
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + containerHeight;
    
    return virtualRows.filter(row => {
      const rowTop = row.y;
      const rowBottom = row.y + row.height;
      return rowBottom >= viewportTop && rowTop <= viewportBottom;
    });
  }, [virtualRows, scrollTop, containerHeight]);

  // Total height for scrollbar
  const totalHeight = virtualRows.reduce((sum, row) => sum + row.height, 0);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-auto ${className || ''}`}
      style={{ height: '100%' }}
    >
      {/* Virtual container with total height */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Render only visible rows */}
        {visibleRows.map((row, rowIndex) => (
          <div
            key={`row-${row.y}`}
            className="absolute left-0 right-0 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
            style={{
              top: row.y,
              height: row.height - 12, // Subtract gap
            }}
          >
            {row.items.map(({ item, index }) => (
              <VirtualThumbnailItem
                key={item._id}
                item={item}
                index={index}
                selection={selection}
                selectionMode={selectionMode}
                onOpen={onOpen}
                onToggle={onToggle}
                colWidth={colWidth}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function VirtualThumbnailItem({
  item,
  index,
  selection,
  selectionMode,
  onToggle,
  onOpen,
  colWidth,
}: {
  item: ImageDocWithDims;
  index: number;
  selection: Set<string>;
  selectionMode: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  colWidth: number;
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
        selected={selectionMode && selection.has(item._id)}
        onClick={() => (selectionMode ? onToggle(item._id) : onOpen(item._id))}
        priority={index < 12} // First 12 items get high priority
      />
      {selectionMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item._id);
          }}
          aria-label={selection.has(item._id) ? "Deselect" : "Select"}
          className="absolute top-2 right-2 w-6 h-6 rounded border border-white/60 bg-black/40 flex items-center justify-center"
        >
          {selection.has(item._id) ? (
            <span className="w-3 h-3 bg-purple-500 block rounded-sm" />
          ) : (
            <span className="w-3 h-3 block rounded-sm" />
          )}
        </button>
      )}
    </div>
  );
}