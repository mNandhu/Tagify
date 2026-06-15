import { cn } from "../lib/cn";
import { resolveMediaUrl } from "../lib/media";
import { decode } from "blurhash";
import React, { useState, useEffect, useRef } from "react";

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

// Global concurrent loading control
class ImageLoadQueue {
  private queue: Array<() => void> = [];
  private loading = 0;
  private readonly maxConcurrent = 12; // Limit concurrent loads

  enqueue(loadFn: () => void) {
    if (this.loading < this.maxConcurrent) {
      this.loading++;
      loadFn();
    } else {
      this.queue.push(loadFn);
    }
  }

  dequeue() {
    this.loading--;
    if (this.queue.length > 0 && this.loading < this.maxConcurrent) {
      this.loading++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const imageLoadQueue = new ImageLoadQueue();

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
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [assignedSrc, setAssignedSrc] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // Track the current load's slot token to ensure exactly-once cleanup per acquired slot.
  const currentSlotTokenRef = useRef<symbol | null>(null);
  // Set the moment we enqueue, so a re-render during the async URL-resolve gap
  // can't enqueue a second slot for the same src (which would leak a slot).
  const enqueuedRef = useRef(false);
  const latestRef = useRef<{ src: string; shouldLoad: boolean }>({
    src,
    shouldLoad,
  });
  latestRef.current.src = src;
  latestRef.current.shouldLoad = shouldLoad;

  const releaseSlot = (token: symbol | null) => {
    // Only release if this token matches the current slot token (prevents double-release).
    if (token && token === currentSlotTokenRef.current) {
      currentSlotTokenRef.current = null;
      imageLoadQueue.dequeue();
    }
  };

  // Cleanup on unmount: release the current slot if any.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseSlot(currentSlotTokenRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When src changes, reset state and release any prior slot.
  useEffect(() => {
    // Release the old slot if src changed mid-load.
    releaseSlot(currentSlotTokenRef.current);
    currentSlotTokenRef.current = null;
    enqueuedRef.current = false;
    setLoaded(false);
    setError(false);
    setAssignedSrc(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Use Intersection Observer for lazy loading
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    // High-priority or eager (virtualized) tiles load immediately on mount.
    if (priority || eager) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect();
          }
        });
      },
      {
        // Observe against the real scroll container, not the viewport: the gallery
        // scrolls inside an inner overflow-auto element, which clips offscreen tiles
        // at zero margin. Anchoring the root here lets rootMargin actually preload.
        root: getRoot?.() ?? null,
        // Start loading ~1.5 screens early so thumbs are decoded by the time
        // they scroll into view — no skeleton flash on normal scrolling.
        rootMargin: "1200px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(img);
    return () => observer.disconnect();
  }, [priority, eager, getRoot]);

  // Acquire a queue slot and only then assign the real <img src>.
  // This avoids double-fetching (preload Image() + <img>) while still limiting concurrency.
  useEffect(() => {
    if (!shouldLoad || loaded || error) return;
    if (assignedSrc || enqueuedRef.current) return; // already started

    enqueuedRef.current = true;
    const srcAtEnqueue = src;
    imageLoadQueue.enqueue(() => {
      // If component unmounted or state changed while waiting in the queue, skip.
      if (!mountedRef.current) {
        imageLoadQueue.dequeue();
        return;
      }
      if (
        !latestRef.current.shouldLoad ||
        latestRef.current.src !== srcAtEnqueue
      ) {
        imageLoadQueue.dequeue();
        return;
      }

      // Acquire a new token for this load attempt.
      const token = Symbol("loadToken");
      currentSlotTokenRef.current = token;
      // src already usable (embedded in the list payload) — assign directly.
      if (preResolved) {
        setAssignedSrc(srcAtEnqueue);
        return;
      }
      // Resolve the real media URL only now (lazy). With FS-backed media this is
      // a passthrough; the deferral is kept cheap and future-proof for any mode
      // that needs a per-tile network resolve.
      resolveMediaUrl(srcAtEnqueue)
        .then((u) => {
          if (!mountedRef.current || currentSlotTokenRef.current !== token) {
            return;
          }
          setAssignedSrc(u);
        })
        .catch(() => {
          if (!mountedRef.current || currentSlotTokenRef.current !== token) {
            return;
          }
          setAssignedSrc(srcAtEnqueue);
        });
    });
  }, [shouldLoad, loaded, error, assignedSrc, src, preResolved]);

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
        onLoad={() => {
          if (!mountedRef.current) return;
          setLoaded(true);
          releaseSlot(currentSlotTokenRef.current);
        }}
        onError={() => {
          if (!mountedRef.current) return;
          setError(true);
          releaseSlot(currentSlotTokenRef.current);
        }}
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
