// Masonry layout math, shared by the CSS-grid gallery (row spans) and the
// virtualized gallery (estimated row heights). Pure functions — the test
// surface that both grids previously open-coded with slightly different
// formulas.

export type Dims = { width?: number; height?: number };

/** Tailwind grid breakpoints used by the gallery: 2 / 3 / 4 columns. */
export function gridColumns(containerWidth: number): number {
  if (containerWidth >= 1024) return 4;
  if (containerWidth >= 768) return 3;
  return 2;
}

/** Width of one column given the container width, column count, and gap. */
export function columnWidth(
  containerWidth: number,
  cols: number,
  gap: number,
): number {
  if (cols <= 0) return containerWidth;
  return (containerWidth - gap * (cols - 1)) / cols;
}

/**
 * Rendered pixel height of an item at a given column width, preserving its
 * aspect ratio. Missing dimensions fall back to square (1×1).
 */
export function aspectHeight(item: Dims, colWidth: number): number {
  const w = item.width || 1;
  const h = item.height || 1;
  return (h / w) * colWidth;
}

/**
 * Estimated row height for virtualization: the aspect height, floored at a
 * minimum so unmeasured items still reserve space.
 */
export function estimateItemHeight(
  item: Dims,
  colWidth: number,
  minHeight = 150,
): number {
  return Math.max(minHeight, aspectHeight(item, colWidth));
}

/**
 * Number of CSS grid rows an item should span, given the auto-row unit and
 * row gap, so that N*rowUnit + (N-1)*rowGap covers `pxHeight`. Always >= 1.
 */
export function rowSpan(
  pxHeight: number,
  rowUnit: number,
  rowGap: number,
): number {
  if (rowUnit <= 0) return 1;
  return Math.max(1, Math.ceil((pxHeight + rowGap) / (rowUnit + rowGap)));
}

/**
 * How far ahead of the viewport a tile starts loading its image
 * (ImageThumbnail's IntersectionObserver rootMargin).
 */
export const LOAD_AHEAD_PX = 1200;

/**
 * How far ahead of the viewport the virtualized grid mounts tiles.
 *
 * Must exceed LOAD_AHEAD_PX so a tile is mounted before it wants to load —
 * otherwise the load-ahead window is clipped by the mount window and thumbs
 * only start fetching once they are nearly on screen. These were two unrelated
 * literals in two files whose ordering was described in a pair of comments and
 * enforced by nothing.
 */
export const OVERSCAN_PX = LOAD_AHEAD_PX + 400;
