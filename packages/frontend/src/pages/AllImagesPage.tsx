import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GalleryGrid } from "../components/GalleryGrid";
import { useToast } from "../components/Toasts";
import {
  Filter,
  CheckSquare,
  Square,
  Tag as TagIcon,
  Slash,
  ImageOff,
} from "lucide-react";
import {
  DEFAULT_FILTERS,
  serializeFilters,
  type Filters,
} from "../lib/imageFilter";
import { useFilters } from "../hooks/useFilters";
import { useImageFeed } from "../hooks/useImageFeed";
import { useScrollRestoration } from "../hooks/useScrollRestoration";

type Library = { _id: string; name?: string; path: string };

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const hasActiveFilter = (f: Filters) =>
  f.tags.length > 0 || !!f.libraryId || f.noTags || f.noAiTags;

export default function AllImagesPage() {
  const { push } = useToast();
  const navigate = useNavigate();

  // Image filter (URL is the single source of truth) and the Image feed it drives.
  const [filters, setFilters] = useFilters();
  const feed = useImageFeed(filters);
  const items = feed.items;

  // Raw search-box text, split into tags on submit.
  const [q, setQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [libs, setLibs] = useState<Library[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Filter popover (kept inside the sticky header so it stays accessible while scrolling)
  const headerRef = useRef<HTMLDivElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filtersPanelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const getScrollContainer = useCallback(() => {
    return (
      (containerRef.current?.closest(".overflow-auto") as HTMLElement | null) ||
      containerRef.current
    );
  }, []);

  // Scroll restoration keyed by the active filter.
  const { save: saveScroll } = useScrollRestoration(
    serializeFilters(filters).toString(),
    getScrollContainer,
    items.length > 0,
  );

  // Load libraries for the filter dropdown, and keep them polled while any
  // library is scanning. Indexing runs as an async background scan, so images
  // land after a library is added/rescanned. The scan-progress poll that
  // triggers a feed refresh lives on the Libraries page, which is unmounted
  // once the user is here — so the gallery must watch scan state itself and
  // refetch the feed as images arrive, instead of needing a full reload.
  const refetchFeedRef = useRef(feed.refetch);
  refetchFeedRef.current = feed.refetch;
  // Seed true so the first poll tick always does one fresh pull on mount —
  // covers a scan that finishes in the race window between the feed's
  // mount-refetch and tick 1, and sidesteps the 30s stale-cache window.
  const wasScanningRef = useRef(true);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let anyScanning = false;
      try {
        const data = await api<Library[]>(`/api/libraries`);
        if (cancelled) return;
        setLibs(data);
        anyScanning = data.some((l) => (l as { scanning?: boolean }).scanning);
        // Refetch while a scan runs AND once more on the scanning -> done
        // transition. The trailing pull matters: cursor pages are keyed by
        // ascending _id and the scan appends higher _ids, so the final batch
        // (and a page-1 that was still short mid-scan, which left hasNextPage
        // false and killed paging) is only picked up by refetching after the
        // scan finishes. Refetch re-derives getNextPageParam, reviving paging.
        if (anyScanning || wasScanningRef.current) refetchFeedRef.current();
        wasScanningRef.current = anyScanning;
      } catch {
        // Ignore transient errors; retry on the next tick.
      }
      if (!cancelled) {
        // Poll briskly during a scan, lazily otherwise to catch scans that
        // start from another page while the gallery stays open.
        timer = setTimeout(tick, anyScanning ? 1500 : 8000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Close filters on outside click / ESC.
  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (filtersPanelRef.current?.contains(target)) return;
      if (filterButtonRef.current?.contains(target)) return;
      setFiltersOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen]);

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = q
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setFilters({ ...filters, tags });
  };

  // Keyboard shortcuts: S toggle selection, F focus search, N no-tags, A no-AI-tags.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const isFormField =
        target &&
        (target.tagName.toLowerCase() === "input" ||
          target.tagName.toLowerCase() === "textarea" ||
          target.tagName.toLowerCase() === "select" ||
          target.isContentEditable);
      if (isFormField) return;

      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        setSelectionMode((v) => {
          const next = !v;
          push(next ? "Selection mode ON" : "Selection mode OFF", "info");
          return next;
        });
      } else if (k === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (k === "n") {
        e.preventDefault();
        const next = !filters.noTags;
        push(next ? "No-tags filter ON" : "No-tags filter OFF", "info");
        setFilters({ ...filters, noTags: next });
      } else if (k === "a") {
        e.preventDefault();
        const next = !filters.noAiTags;
        push(next ? "No-AI-tags filter ON" : "No-AI-tags filter OFF", "info");
        setFilters({ ...filters, noAiTags: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push, filters, setFilters]);

  const toggleSelection = useCallback((id: string) => {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const openImage = useCallback(
    (id: string) => {
      saveScroll();
      const sp = serializeFilters(filters);
      navigate(`/image/${encodeURIComponent(id)}?${sp.toString()}`);
    },
    [filters, navigate, saveScroll],
  );

  const clearSelection = () => setSelection(new Set());
  const selectionActive = selection.size > 0;

  // When leaving selection mode, drop the current selection.
  useEffect(() => {
    if (!selectionMode && selectionActive) setSelection(new Set());
  }, [selectionMode, selectionActive]);

  // Infinite scroll: fetch the next feed page when the sentinel comes into view.
  useEffect(() => {
    if (!feed.hasNextPage || feed.isFetchingNextPage) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) feed.fetchNextPage();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [feed.hasNextPage, feed.isFetchingNextPage, feed.fetchNextPage]);

  return (
    <div ref={containerRef} className="p-4 space-y-3">
      <div
        ref={headerRef}
        className="sticky top-0 z-10 -mt-4 -mx-4 px-4 pt-4 bg-neutral-900/85 backdrop-blur border-b border-neutral-800"
      >
        <div className="flex items-center gap-2 pb-3">
          <button
            ref={filterButtonRef}
            className={
              "p-2 rounded border inline-flex items-center justify-center " +
              (filtersOpen
                ? "bg-purple-700 border-purple-600 text-white"
                : "bg-neutral-800 hover:bg-neutral-700 border-neutral-700 text-neutral-200")
            }
            onClick={() => setFiltersOpen((v) => !v)}
            aria-label={filtersOpen ? "Hide filters" : "Show filters"}
            title={filtersOpen ? "Hide filters" : "Show filters"}
          >
            <Filter size={18} />
          </button>
          <form onSubmit={onSubmitSearch} className="flex-1">
            <input
              className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800 w-full"
              placeholder="Search tags… (comma separated)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              ref={searchInputRef}
            />
          </form>
          <button
            className={
              "p-2 rounded border inline-flex items-center justify-center " +
              (selectionMode
                ? "bg-purple-700 border-purple-600 text-white"
                : "bg-neutral-800 hover:bg-neutral-700 border-neutral-700 text-neutral-200")
            }
            onClick={() => setSelectionMode((v) => !v)}
            aria-label={
              selectionMode ? "Exit selection mode" : "Enter selection mode"
            }
            title={selectionMode ? "Done selecting" : "Select"}
          >
            {selectionMode ? <CheckSquare size={18} /> : <Square size={18} />}
          </button>
          {selectionMode && selectionActive && (
            <button
              className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-500"
              onClick={async () => {
                const ids = Array.from(selection);
                if (!ids.length) return;
                const ok = confirm(
                  `Run AI tagging for ${ids.length} selected images?`,
                );
                if (!ok) return;
                try {
                  const r = await fetch(`/api/ai/tag`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids }),
                  });
                  if (!r.ok) throw new Error(await r.text());
                  push(`Queued AI tagging for ${ids.length} images`, "success");
                  setSelectionMode(false);
                } catch (e) {
                  push(`Failed to start AI job: ${String(e)}`, "error");
                }
              }}
            >
              Batch actions
            </button>
          )}
        </div>

        {filtersOpen && (
          <div
            ref={filtersPanelRef}
            className="pb-3"
            role="dialog"
            aria-label="Filters"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm mb-1">Tag logic</label>
                <select
                  aria-label="Tag logic"
                  className="px-2 py-2 rounded bg-neutral-900 border border-neutral-800 w-full"
                  value={filters.logic}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      logic: e.target.value as Filters["logic"],
                    })
                  }
                >
                  <option value="and">Match all tags (AND)</option>
                  <option value="or">Match any tag (OR)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Library</label>
                <select
                  aria-label="Library filter"
                  className="px-2 py-2 rounded bg-neutral-900 border border-neutral-800 w-full"
                  value={filters.libraryId || ""}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      libraryId: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">All libraries</option>
                  {libs.map((l) => (
                    <option key={l._id} value={l._id}>
                      {l.name || l.path}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={
                      "p-2 rounded border inline-flex items-center justify-center transition-colors " +
                      (filters.noTags
                        ? "bg-purple-700/30 border-purple-600 text-purple-200"
                        : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800")
                    }
                    onClick={() =>
                      setFilters({ ...filters, noTags: !filters.noTags })
                    }
                    aria-label={filters.noTags ? "No tags on" : "No tags off"}
                    title="No tags"
                  >
                    <span className="relative inline-flex items-center justify-center w-5 h-5">
                      <TagIcon size={16} />
                      {filters.noTags && (
                        <Slash
                          size={16}
                          className="absolute inset-0 text-purple-300 opacity-90"
                        />
                      )}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={
                      "px-3 py-2 rounded border text-sm transition-colors " +
                      (filters.noAiTags
                        ? "bg-emerald-700/25 border-emerald-600 text-emerald-200"
                        : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800")
                    }
                    onClick={() =>
                      setFilters({ ...filters, noAiTags: !filters.noAiTags })
                    }
                    aria-label={
                      filters.noAiTags ? "No AI tags on" : "No AI tags off"
                    }
                    title="No AI tags"
                  >
                    No AI
                  </button>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
                  onClick={() => {
                    setQ("");
                    setFilters(DEFAULT_FILTERS);
                  }}
                >
                  Clear filters
                </button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
                  onClick={clearSelection}
                >
                  Clear selection
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {!feed.isLoading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="bg-neutral-800/50 rounded-2xl p-12 border border-neutral-700/50 max-w-md text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-neutral-700/50 mb-6">
              <ImageOff size={40} className="text-neutral-400" />
            </div>
            <h2 className="text-2xl font-semibold text-neutral-100 mb-3">
              No Images Found
            </h2>
            <p className="text-neutral-400 mb-6 leading-relaxed">
              {hasActiveFilter(filters)
                ? "No images match your current filters. Try adjusting your search criteria."
                : "You don't have any images yet. Add a library to start importing your images."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {hasActiveFilter(filters) && (
                <button
                  onClick={() => {
                    setQ("");
                    setFilters(DEFAULT_FILTERS);
                  }}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors"
                >
                  Clear Filters
                </button>
              )}
              <button
                onClick={() => navigate("/libraries")}
                className="px-4 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-neutral-100 font-medium transition-colors"
              >
                Go to Libraries
              </button>
            </div>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <GalleryGrid
          items={items}
          selection={selection}
          onToggle={toggleSelection}
          onOpen={openImage}
          getScrollContainer={getScrollContainer}
          selectionMode={selectionMode}
        />
      )}

      <div ref={sentinelRef} className="h-8" />
    </div>
  );
}
