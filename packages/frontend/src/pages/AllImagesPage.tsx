import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { GalleryGrid } from "../components/GalleryGrid";
import { useToast } from "../components/Toasts";
import {
  Filter,
  CheckSquare,
  Square,
  Tag as TagIcon,
  Slash,
} from "lucide-react";
import {
  saveScrollState,
  restoreScrollState,
  clearScrollState,
  clearOldScrollStates,
  createDebouncedScrollSaver,
} from "../lib/scrollRestoration";

type ImageDoc = { _id: string; thumb_rel?: string; path: string };
type Library = { _id: string; name?: string; path: string };

type Filters = {
  q: string;
  tags: string[];
  logic: "and" | "or";
  libraryId?: string;
  noTags?: boolean;
};

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function AllImagesPage() {
  const { push } = useToast();
  const [items, setItems] = useState<ImageDoc[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [libs, setLibs] = useState<Library[]>([]);
  const [filters, setFilters] = useState<Filters>({
    q: "",
    tags: [],
    logic: "and",
    noTags: false,
  });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const limit = 100;
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Scroll restoration state
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldRestoreScroll, setShouldRestoreScroll] = useState(false);
  const [restoredScrollState, setRestoredScrollState] =
    useState<ReturnType<typeof restoreScrollState>>(null);
  const debouncedScrollSaver = useMemo(
    () => createDebouncedScrollSaver(200),
    []
  );

  // Filter popover (kept inside the sticky header container so it stays accessible while scrolling)
  const headerRef = useRef<HTMLDivElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filtersPanelRef = useRef<HTMLDivElement | null>(null);

  // Keep latest values for scroll saver without reattaching listeners.
  const scrollSaveRef = useRef<{
    searchParams: URLSearchParams;
    cursor: string | null;
    itemCount: number;
  }>({ searchParams, cursor, itemCount: items.length });

  useEffect(() => {
    scrollSaveRef.current = {
      searchParams,
      cursor,
      itemCount: items.length,
    };
  }, [searchParams, cursor, items.length]);

  // Clean up old scroll states on mount
  useEffect(() => {
    clearOldScrollStates();
  }, []);

  // Track scroll position for restoration (attach once; read latest values from ref)
  useEffect(() => {
    // Use the parent scroll container (from App.tsx)
    const container =
      (containerRef.current?.closest(".overflow-auto") as HTMLElement) ||
      containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { searchParams, cursor, itemCount } = scrollSaveRef.current;
      debouncedScrollSaver(
        container.scrollTop,
        searchParams,
        cursor || undefined,
        itemCount
      );
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [debouncedScrollSaver]);
  // Note: getScrollContainer() always returns the same element (the app's main scroll container)
  // after mount, so we don't need to depend on it. If the implementation changes such that the
  // scroll container can change during the component's lifetime, add a dependency on the container ref.

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

  // Check for scroll restoration on mount or when returning from ImageView
  useEffect(() => {
    const restored = restoreScrollState(searchParams);
    if (restored) {
      setRestoredScrollState(restored);
      setShouldRestoreScroll(true);
    }
  }, []); // Only run on mount

  // load libraries for filter
  useEffect(() => {
    api<Library[]>(`/api/libraries`)
      .then(setLibs)
      .catch(() => {});
  }, []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.tags.length) filters.tags.forEach((t) => p.append("tags", t));
    if (filters.logic) p.set("logic", filters.logic);
    if (filters.libraryId) p.set("library_id", filters.libraryId);
    if (filters.noTags) p.set("no_tags", "1");
    p.set("limit", String(limit));
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  }, [filters, cursor]);

  // initial load and when filters or pagination change
  useEffect(() => {
    const url = `/api/images${queryString ? `?${queryString}` : ""}`;
    const controller = new AbortController();
    const isPaging = !!cursor;
    setLoading(true);
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as ImageDoc[];
      })
      .then((data) => {
        setItems((prev) => (isPaging ? [...prev, ...data] : data));
        setHasMore(data.length === limit);
        if (data.length) {
          const last = data[data.length - 1];
          setNextCursor(last._id);
        } else {
          setNextCursor(null);
        }
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        console.error(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [queryString]);

  // Restore scroll position after data loads
  useEffect(() => {
    if (
      !shouldRestoreScroll ||
      !restoredScrollState ||
      !containerRef.current ||
      loading
    ) {
      return;
    }

    const container =
      (containerRef.current?.closest(".overflow-auto") as HTMLElement) ||
      containerRef.current;
    const targetScrollTop = restoredScrollState.scrollTop;

    // If we have fewer items than before, try to load more data
    if (restoredScrollState.itemCount > items.length && hasMore && !cursor) {
      // Start loading from the restored cursor position
      if (
        restoredScrollState.cursor &&
        restoredScrollState.cursor !== nextCursor
      ) {
        setCursor(restoredScrollState.cursor);
        return; // Will trigger data load, then retry restoration
      }
    }

    // Attempt to restore scroll position
    setTimeout(() => {
      if (container.scrollHeight > targetScrollTop) {
        container.scrollTo({
          top: targetScrollTop,
          behavior: "auto", // Instant restore
        });
      }
      setShouldRestoreScroll(false);
      setRestoredScrollState(null);
    }, 100); // Small delay to ensure DOM is updated
  }, [
    shouldRestoreScroll,
    restoredScrollState,
    items.length,
    loading,
    hasMore,
    cursor,
    nextCursor,
  ]);

  // Clear scroll state when filters change
  useEffect(() => {
    if (!shouldRestoreScroll) {
      // Only clear if we're not in the middle of restoring
      clearScrollState(searchParams);
    }
  }, [
    filters.tags,
    filters.logic,
    filters.libraryId,
    filters.noTags,
    shouldRestoreScroll,
  ]);

  // sync filters from URL on mount and whenever search params change
  useEffect(() => {
    const sp = new URLSearchParams(searchParams);
    const urlTags = sp.getAll("tags");
    const singleTag = sp.getAll("tag");
    const lib = sp.get("library_id") || undefined;
    const noTags = sp.get("no_tags") === "1";
    const logic = (sp.get("logic") as Filters["logic"]) || undefined;
    const nextTags = urlTags.length ? urlTags : singleTag;
    // Always synchronize filter state from the URL (single source of truth).
    // This fixes cases like navigating to /?no_tags=1, which previously failed to
    // update state and then got overwritten by the "push filters to URL" effect.
    setFilters((f) => ({
      ...f,
      tags: nextTags,
      libraryId: lib,
      logic: logic || f.logic,
      noTags,
    }));

    // Back-compat: migrate legacy ?tag=... to ?tags=... (multi) once.
    if (singleTag.length) {
      singleTag.forEach(() => sp.delete("tag"));
      nextTags.forEach((t) => sp.append("tags", t));
      setSearchParams(sp, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // push filters to URL when they change (excluding pagination cursor)
  useEffect(() => {
    const sp = new URLSearchParams();
    filters.tags.forEach((t) => sp.append("tags", t));
    if (filters.logic) sp.set("logic", filters.logic);
    if (filters.libraryId) sp.set("library_id", filters.libraryId);
    if (filters.noTags) sp.set("no_tags", "1");
    setSearchParams(sp, { replace: true });
  }, [filters, setSearchParams]);

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = filters.q
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setFilters((f) => ({ ...f, tags }));
    setItems([]);
    setCursor(null);
  };

  // Keyboard shortcuts: S toggle selection, F focus search, N toggle no-tags
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't trigger global shortcuts when typing in form fields
      const target = e.target as HTMLElement;
      const isFormField =
        target &&
        (target.tagName.toLowerCase() === "input" ||
          target.tagName.toLowerCase() === "textarea" ||
          target.tagName.toLowerCase() === "select" ||
          target.isContentEditable);

      if (isFormField) {
        return;
      }

      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        setSelectionMode((v) => {
          const next = !v;
          push(next ? "Selection mode ON" : "Selection mode OFF", "info");
          return next;
        });
      }
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setFilters((f) => {
          const next = !f.noTags;
          push(next ? "No-tags filter ON" : "No-tags filter OFF", "info");
          return { ...f, noTags: next };
        });
        setItems([]);
        setCursor(null);
        setNextCursor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push]);

  const toggleSelection = useCallback((id: string) => {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const getScrollContainer = useCallback(() => {
    return (
      (containerRef.current?.closest(".overflow-auto") as HTMLElement | null) ||
      containerRef.current
    );
  }, []);

  const openImage = useCallback(
    (id: string) => {
      // Save current scroll position before navigating
      const container = getScrollContainer();
      if (container) {
        const scrollTop = container.scrollTop;
        saveScrollState(
          scrollTop,
          searchParams,
          cursor || undefined,
          items.length
        );
      }

      const sp = new URLSearchParams();
      filters.tags.forEach((t) => sp.append("tags", t));
      if (filters.logic) sp.set("logic", filters.logic);
      if (filters.libraryId) sp.set("library_id", filters.libraryId);
      if (filters.noTags) sp.set("no_tags", "1");
      if (cursor) sp.set("cursor", cursor);
      sp.set("limit", String(limit));
      navigate(`/image/${encodeURIComponent(id)}?${sp.toString()}`);
    },
    [
      cursor,
      filters.libraryId,
      filters.logic,
      filters.noTags,
      filters.tags,
      getScrollContainer,
      items.length,
      limit,
      navigate,
      searchParams,
    ]
  );

  const clearSelection = () => setSelection(new Set());
  const selectionActive = selection.size > 0;

  // when turning off selection mode, clear current selection
  useEffect(() => {
    if (!selectionMode && selectionActive) {
      setSelection(new Set());
    }
  }, [selectionMode, selectionActive]);

  // observe sentinel for infinite scroll
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (nextCursor && !loading) {
          setCursor(nextCursor);
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, nextCursor]);

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
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
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
              onClick={() =>
                alert(`Batch actions coming soon: ${selection.size} selected`)
              }
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
                    setFilters((f) => ({
                      ...f,
                      logic: e.target.value as Filters["logic"],
                    }))
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
                    setFilters((f) => ({
                      ...f,
                      libraryId: e.target.value || undefined,
                    }))
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
                <button
                  type="button"
                  className={
                    "p-2 rounded border inline-flex items-center justify-center transition-colors " +
                    (filters.noTags
                      ? "bg-purple-700/30 border-purple-600 text-purple-200"
                      : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800")
                  }
                  onClick={() => {
                    setFilters((f) => ({ ...f, noTags: !f.noTags }));
                    setItems([]);
                    setCursor(null);
                    setNextCursor(null);
                  }}
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
              </div>
              <div className="flex items-end gap-2">
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
                  onClick={() =>
                    setFilters({
                      q: "",
                      tags: [],
                      logic: "and",
                      libraryId: undefined,
                      noTags: false,
                    })
                  }
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

      <GalleryGrid
        items={items}
        selection={selection}
        onToggle={toggleSelection}
        onOpen={openImage}
        getScrollContainer={getScrollContainer}
        selectionMode={selectionMode}
      />

      <div ref={sentinelRef} className="h-8" />
    </div>
  );
}
