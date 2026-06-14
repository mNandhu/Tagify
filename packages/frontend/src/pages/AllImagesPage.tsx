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
  Images,
  Sparkles,
} from "lucide-react";
import {
  DEFAULT_FILTERS,
  serializeFilters,
  type Filters,
} from "../lib/imageFilter";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import {
  TagSearchInput,
  type TagSuggestion,
} from "../components/TagSearchInput";
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
  f.tags.length > 0 || !!f.libraryId || f.noTags || f.noAiTags || f.quarantined;

export default function AllImagesPage() {
  const { push } = useToast();
  const navigate = useNavigate();

  // Image filter (URL is the single source of truth) and the Image feed it drives.
  const [filters, setFilters] = useFilters();
  const feed = useImageFeed(filters);
  const items = feed.items;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [libs, setLibs] = useState<Library[]>([]);
  // Known tags (with image counts) powering the search autocomplete.
  const [tagOptions, setTagOptions] = useState<TagSuggestion[]>([]);
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

  // Load the tag list once for autocomplete; counts come straight from the
  // same aggregate the Tags page uses (manual tags included).
  useEffect(() => {
    api<TagSuggestion[]>(`/api/tags?include_manual=1`)
      .then(setTagOptions)
      .catch(() => setTagOptions([]));
  }, []);

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
      } else if (k === "q") {
        e.preventDefault();
        const next = !filters.quarantined;
        push(next ? "Showing quarantined" : "Showing active feed", "info");
        setFilters({ ...filters, quarantined: next });
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
    <div ref={containerRef} className="p-6 space-y-3">
      <PageHeader
        icon={Images}
        title="All Images"
        count={items.length}
        description={
          selectionMode
            ? `${selection.size} selected`
            : "Browse, filter, and tag your library."
        }
      />
      <div
        ref={headerRef}
        className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-neutral-900/85 backdrop-blur border-b border-neutral-800"
      >
        <div className="flex items-center gap-2">
          <Button
            ref={filterButtonRef}
            size="icon"
            variant="secondary"
            active={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-label={filtersOpen ? "Hide filters" : "Show filters"}
            title={filtersOpen ? "Hide filters" : "Show filters"}
          >
            <Filter size={18} />
          </Button>
          <div className="flex-1">
            <TagSearchInput
              ref={searchInputRef}
              value={filters.tags}
              onChange={(tags) => setFilters({ ...filters, tags })}
              suggestions={tagOptions}
              placeholder="Search tags…"
            />
          </div>
          <Button
            size="icon"
            variant="secondary"
            active={selectionMode}
            onClick={() => setSelectionMode((v) => !v)}
            aria-label={
              selectionMode ? "Exit selection mode" : "Enter selection mode"
            }
            title={selectionMode ? "Done selecting" : "Select"}
          >
            {selectionMode ? <CheckSquare size={18} /> : <Square size={18} />}
          </Button>
          {selectionMode && selectionActive && (
            <Button
              variant="primary"
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
              <Sparkles size={16} /> Tag {selection.size}
            </Button>
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
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Tag logic
                </label>
                <Select
                  aria-label="Tag logic"
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
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Library
                </label>
                <Select
                  aria-label="Library filter"
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
                </Select>
              </div>
              <div className="flex items-end">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    active={filters.noTags}
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
                          className="absolute inset-0 text-purple-200 opacity-90"
                        />
                      )}
                    </span>
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    active={filters.noAiTags}
                    onClick={() =>
                      setFilters({ ...filters, noAiTags: !filters.noAiTags })
                    }
                    aria-label={
                      filters.noAiTags ? "No AI tags on" : "No AI tags off"
                    }
                    title="No AI tags"
                  >
                    No AI
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    active={filters.quarantined}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        quarantined: !filters.quarantined,
                      })
                    }
                    aria-label={
                      filters.quarantined
                        ? "Showing quarantined"
                        : "Show quarantined"
                    }
                    title="Quarantined images"
                  >
                    Quarantined
                  </Button>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Clear filters
                </Button>
                <Button onClick={clearSelection}>Clear selection</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {!feed.isLoading && items.length === 0 && (
        <EmptyState
          icon={ImageOff}
          title="No images found"
          description={
            hasActiveFilter(filters)
              ? "No images match your current filters. Try adjusting your search criteria."
              : "You don't have any images yet. Add a library to start importing your images."
          }
          actions={
            <>
              {hasActiveFilter(filters) && (
                <Button
                  variant="primary"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                >
                  Clear filters
                </Button>
              )}
              <Button onClick={() => navigate("/libraries")}>
                Go to Libraries
              </Button>
            </>
          }
        />
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
