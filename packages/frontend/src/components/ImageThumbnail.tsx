import { cn } from "../lib/cn";
import React, { useState, useEffect, useRef } from "react";

// Global concurrent loading control
class ImageLoadQueue {
  private queue: Array<() => void> = [];
  private loading = 0;
  private readonly maxConcurrent = 8; // Limit concurrent loads

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
}: {
  src: string;
  selected?: boolean;
  onClick?: () => void;
  alt?: string;
  width?: number;
  height?: number;
  priority?: boolean; // High priority for above-the-fold images
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [assignedSrc, setAssignedSrc] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // Track the current load's slot token to ensure exactly-once cleanup per acquired slot.
  const currentSlotTokenRef = useRef<symbol | null>(null);
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
    setLoaded(false);
    setError(false);
    setAssignedSrc(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Use Intersection Observer for lazy loading
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    // High priority images load immediately
    if (priority) {
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
        rootMargin: "50px", // Start loading when within 50px of viewport
        threshold: 0.1,
      }
    );

    observer.observe(img);
    return () => observer.disconnect();
  }, [priority]);

  // Acquire a queue slot and only then assign the real <img src>.
  // This avoids double-fetching (preload Image() + <img>) while still limiting concurrency.
  useEffect(() => {
    if (!shouldLoad || loaded || error) return;
    if (assignedSrc) return; // already started

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
      setAssignedSrc(srcAtEnqueue);
    });
  }, [shouldLoad, loaded, error, assignedSrc, src]);

  return (
    <button
      className={cn(
        "group relative w-full overflow-hidden rounded bg-neutral-900",
        "content-visibility-auto contain-intrinsic-thumb", // Improve offscreen performance
        selected && "ring-2 ring-purple-500"
      )}
      onClick={onClick}
    >
      {/* Skeleton shimmer (only while loading) */}
      {!loaded && !error && (
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
          "h-auto w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]",
          "transition-opacity duration-300",
          loaded && !error ? "opacity-100" : "opacity-0"
        )}
        loading="lazy"
      />
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/10" />
    </button>
  );
}
