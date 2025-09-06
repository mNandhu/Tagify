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
        rootMargin: '50px', // Start loading when within 50px of viewport
        threshold: 0.1,
      }
    );

    observer.observe(img);
    return () => observer.disconnect();
  }, [priority]);

  // Load image through queue when shouldLoad becomes true
  useEffect(() => {
    if (!shouldLoad || loaded || error) return;

    const img = imgRef.current;
    if (!img) return;

    const loadImage = () => {
      const tempImg = new Image();
      
      tempImg.onload = () => {
        setLoaded(true);
        imageLoadQueue.dequeue();
      };
      
      tempImg.onerror = () => {
        setError(true);
        imageLoadQueue.dequeue();
      };
      
      tempImg.src = src;
    };

    imageLoadQueue.enqueue(loadImage);
  }, [shouldLoad, src, loaded, error]);

  return (
    <button
      className={cn(
        "group relative w-full overflow-hidden rounded bg-neutral-900",
        "content-visibility: auto", // Improve offscreen performance
        selected && "ring-2 ring-purple-500"
      )}
      onClick={onClick}
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: width && height ? `${width}px ${height}px` : 'auto',
      }}
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
        src={loaded ? src : undefined} // Only set src when loaded to prevent browser prefetch
        alt={alt}
        decoding="async"
        fetchPriority={priority ? "high" : "low"}
        width={width}
        height={height}
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
