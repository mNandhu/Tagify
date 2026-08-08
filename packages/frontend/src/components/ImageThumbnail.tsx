import { cn } from "../lib/cn";
import { LOAD_AHEAD_PX } from "../lib/masonryLayout";
import { useImageLoadSlot } from "../hooks/useImageLoadSlot";
import { decode } from "blurhash";
import React, { useEffect, useRef } from "react";

// Decodes a BlurHash to a canvas, scaled up by CSS to fill the tile. Bigger
// than the bare minimum so the upscaled preview reads as a soft photo rather
// than a few colour blobs; still cheap since BlurHash decode is O(px * comps).
const BLUR_PX = 64;

const BlurhashCanvas = React.memo(function BlurhashCanvas({
  hash,
  loaded,
}: {
  hash: string;
  loaded: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      const pixels = decode(hash, BLUR_PX, BLUR_PX);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const imageData = ctx.createImageData(BLUR_PX, BLUR_PX);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    } catch {
      // Invalid hash — leave the canvas transparent; the bg shows through.
    }
  }, [hash]);
  return (
    <canvas
      ref={ref}
      width={BLUR_PX}
      height={BLUR_PX}
      aria-hidden="true"
      className={cn(
        "absolute inset-0 h-full w-full rounded transition-opacity duration-500 ease-out",
        loaded ? "opacity-0" : "opacity-100"
      )}
    />
  );
});

export function ImageThumbnail({
  src,
  selected,
  onClick,
  alt,
  width,
  height,
  priority = false,
  preResolved = false,
  blurhash,
  getRoot,
  eager = false,
}: {
  src: string;
  selected?: boolean;
  onClick?: () => void;
  alt?: string;
  width?: number;
  height?: number;
  priority?: boolean; // High priority for above-the-fold images
  preResolved?: boolean; // src is already a usable URL; skip resolveMediaUrl
  blurhash?: string; // BlurHash placeholder shown until the image loads
  // Scroll container to use as the IntersectionObserver root. Must be the actual
  // scrolling element — rootMargin only expands the root, while intermediate
  // scroll containers clip at zero margin, killing the preload window.
  getRoot?: () => HTMLElement | null;
  // Skip the per-tile IntersectionObserver and load as soon as mounted. Used by
  // the virtualized grid, which already gates mounting to a near-viewport
  // overscan window — a second IO gate is redundant and, worse, broken here:
  // content-visibility:auto skips laying out the <img>, so IO can't measure it
  // until the browser un-skips the tile (~half a screen away), defeating the
  // preload. Fetch+decode still run while offscreen (cv only skips paint).
  eager?: boolean;
}) {
  const { assignedSrc, loaded, error, imgRef, onLoad, onError } =
    useImageLoadSlot({
      src,
      priority,
      eager,
      preResolved,
      getRoot,
      // Start loading ~1.5 screens early so thumbs are decoded by the time they
      // scroll into view. Shares one constant with the virtualized grid's
      // overscan, which must stay wider than this.
      rootMargin: `${LOAD_AHEAD_PX}px 0px`,
    });

  return (
    <button
      className={cn(
        "group relative w-full overflow-hidden rounded bg-neutral-900",
        // content-visibility:auto skips painting offscreen tiles to cut work —
        // but in the virtualized grid (eager) it withholds paint of mounted,
        // loaded tiles until the browser's proximity heuristic flips them on
        // (~half a screen in), leaving black gaps while scrolling. The grid
        // already virtualizes, so the skip is redundant there; only enable it
        // for the non-virtualized StandardGrid, where every tile is in the DOM.
        !eager && "content-visibility-auto contain-intrinsic-thumb",
        selected && "ring-2 ring-purple-500"
      )}
      onClick={onClick}
    >
      {/* Placeholder: a decoded BlurHash preview when we have one (no grey
          "loading" state), else a shimmer skeleton. The BlurHash stays mounted
          across load so it can cross-fade out as the image fades in, instead of
          popping. */}
      {!error && blurhash && <BlurhashCanvas hash={blurhash} loaded={loaded} />}
      {!loaded && !error && !blurhash && (
        <div
          className={cn(
            "absolute inset-0 rounded bg-neutral-800/60 animate-pulse",
            "motion-reduce:animate-none"
          )}
          aria-hidden="true"
        />
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-800 text-neutral-500">
          <span className="text-sm">Failed to load</span>
        </div>
      )}

      <img
        ref={imgRef}
        src={assignedSrc ?? undefined}
        alt={alt}
        decoding="async"
        fetchPriority={priority ? "high" : "low"}
        width={width}
        height={height}
        onLoad={onLoad}
        onError={onError}
        className={cn(
          "h-auto w-full object-cover group-hover:scale-[1.02]",
          // Animate both the load-in fade and the hover zoom; 500ms fade
          // matches the BlurHash cross-fade so they dissolve together.
          "transition-[opacity,transform] duration-500 ease-out",
          loaded && !error ? "opacity-100" : "opacity-0"
        )}
        loading="lazy"
      />
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/10" />
    </button>
  );
}
