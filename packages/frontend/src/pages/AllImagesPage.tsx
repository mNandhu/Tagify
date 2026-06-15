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
  Layers,
  ArrowLeft,
} from "lucide-react";
import {
  DEFAULT_FILTERS,
  serializeFilters,
  type Filters,
} from "../lib/imageFilter";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import {
  TagSearchInput,
  type TagSuggestion,
} from "../components/TagSearchInput";
import { useFilters } from "../hooks/useFilters";
import {
  useImageFeed,
  useImageGroups,
  imageFeedKey,
} from "../hooks/useImageFeed";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { PAGE_LIMIT, type ImageDoc } from "../lib/imageFilter";
import { nextFocusIndex, isGridNavKey } from "../lib/gridNav";
import { gridColumns } from "../lib/masonryLayout";
import { setScore as apiSetScore, setQuarantine as apiSetQuarantine } from "../lib/gen";

type Library = { _id: string; name?: string; path: string };

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const hasActiveFilter = (f: Filters) =>
  f.tags.length > 0 ||
  !!f.libraryId ||
  f.noTags ||
  f.noAiTags ||
  f.quarantined ||
  f.promptTerms.length > 0 ||
  !!f.model ||
  f.minW != null ||
  f.maxW != null ||
  f.minH != null ||
  f.maxH != null ||
  !!f.groupId;

export default function AllImagesPage() {
  const { push } = useToast();
  const navigate = useNavigate();

  // Image filter (URL is the single source of truth) and the Image feed it drives.
  const [filters, setFilters] = useFilters();
  const feed = useImageFeed(filters);
  // Grouped (batch-collapsed) view: active only when collapsing AND not drilled
  // into a specific batch. Drilling in (groupId) shows that batch ungrouped.
  const groupMode = filters.group && !filters.groupId;
  const groups = useImageGroups(filters, groupMode);
  const activeFeed = groupMode ? groups : feed;
  const items = activeFeed.items;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [libs, setLibs] = useState<Library[]>([]);
  // Known tags (with image counts) powering the search autocomplete.
  const [tagOptions, setTagOptions] = useState<TagSuggestion[]>([]);
  // Distinct checkpoints (with counts) for the model filter dropdown.
  const [modelOptions, setModelOptions] = useState<
    { model: string; count: number }[]
  >([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  // Keyboard triage: index of the focused tile (-1 = none). Disabled in
  // selection mode and in the grouped view (tiles there are batch reps).
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const queryClient = useQueryClient();

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

  // Load the tag list once for autocomplete. merge_sources collapses the three
  // sources of each tag (AI / manual / prompt) into one cross-source `any:<base>`
  // suggestion so the dropdown shows a single "tag1" row instead of three
  // near-duplicates; the count is distinct images (a tag applied from two
  // sources isn't double-counted). Selecting it matches images tagged from any
  // source (the backend expands `any:`).
  useEffect(() => {
    api<TagSuggestion[]>(
      `/api/tags?include_manual=1&include_prompt=1&merge_sources=1`,
    )
      .then(setTagOptions)
      .catch(() => setTagOptions([]));
  }, []);

  // Distinct extracted checkpoints for the model dropdown.
  useEffect(() => {
    api<{ model: string; count: number }[]>(`/api/images/models`)
      .then(setModelOptions)
      .catch(() => setModelOptions([]));
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
      if (n.has(id)) n.delete(id); else n.add(id);
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

  // Infinite scroll: fetch the next page (feed or grouped view) on sentinel view.
  useEffect(() => {
    if (!activeFeed.hasNextPage || activeFeed.isFetchingNextPage) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) activeFeed.fetchNextPage();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [
    activeFeed.hasNextPage,
    activeFeed.isFetchingNextPage,
    activeFeed.fetchNextPage,
  ]);

  // Open a tile: in grouped view, clicking a batch (>1) drills into its members
  // instead of opening the representative image.
  const openTile = useCallback(
    (id: string) => {
      if (groupMode) {
        const it = items.find((x) => x._id === id);
        if (it && (it.group_count ?? 1) > 1 && it.group_id) {
          setFilters({ ...filters, group: false, groupId: it.group_id });
          return;
        }
      }
      openImage(id);
    },
    [groupMode, items, filters, setFilters, openImage],
  );

  // --- Keyboard triage on the focused tile -----------------------------------
  const triageEnabled = !selectionMode && !groupMode;

  // Optimistically patch the feed cache so a score/quarantine shows instantly.
  const patchFeed = useCallback(
    (mut: (pages: ImageDoc[][]) => ImageDoc[][]) => {
      queryClient.setQueryData<InfiniteData<ImageDoc[]>>(
        imageFeedKey(filters, PAGE_LIMIT),
        (old) => (old ? { ...old, pages: mut(old.pages) } : old),
      );
    },
    [queryClient, filters],
  );

  const triageScore = useCallback(
    async (n: number) => {
      const it = items[focusedIndex];
      if (!it) return;
      patchFeed((pages) =>
        pages.map((pg) =>
          pg.map((x) => (x._id === it._id ? { ...x, score: n } : x)),
        ),
      );
      try {
        await apiSetScore(it._id, n);
      } catch (e) {
        push(`Failed to set score: ${String(e)}`, "error");
        feed.refetch();
      }
    },
    [items, focusedIndex, patchFeed, push, feed],
  );

  const triageQuarantine = useCallback(async () => {
    const it = items[focusedIndex];
    if (!it) return;
    // Default feed quarantines; the quarantined view restores. Either way the
    // tile leaves the current list, so drop it and keep focus in range.
    const next = !filters.quarantined;
    patchFeed((pages) => pages.map((pg) => pg.filter((x) => x._id !== it._id)));
    setFocusedIndex((i) => Math.min(i, items.length - 2));
    try {
      await apiSetQuarantine(it._id, next);
      push(next ? "Quarantined" : "Restored", "info");
    } catch (e) {
      push(`Failed: ${String(e)}`, "error");
      feed.refetch();
    }
  }, [items, focusedIndex, filters.quarantined, patchFeed, push, feed]);

  useEffect(() => {
    if (!triageEnabled) {
      setFocusedIndex(-1);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (
        t &&
        (t.tagName.toLowerCase() === "input" ||
          t.tagName.toLowerCase() === "textarea" ||
          t.tagName.toLowerCase() === "select" ||
          t.isContentEditable)
      )
        return;
      if (isGridNavKey(e.key)) {
        e.preventDefault();
        const key = e.key; // narrowed to GridNavKey before the closure
        const cols = gridColumns(containerRef.current?.clientWidth || 0);
        setFocusedIndex((prev) => nextFocusIndex(prev, key, cols, items.length));
      } else if (e.key >= "0" && e.key <= "5") {
        if (focusedIndex >= 0) {
          e.preventDefault();
          void triageScore(Number(e.key));
        }
      } else if (e.key === "x" || e.key === "X" || e.key === "Delete") {
        if (focusedIndex >= 0) {
          e.preventDefault();
          void triageQuarantine();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triageEnabled, items.length, focusedIndex, triageScore, triageQuarantine]);

  // Keep the focused tile in view + actually DOM-focused (so the app's arrow-key
  // scroll handler defers to us). Retry once after a tick for the virtualized
  // grid, where an off-screen tile mounts only after its scroll lands.
  useEffect(() => {
    if (focusedIndex < 0) return;
    const sc = getScrollContainer();
    const focusEl = () => {
      const el = sc?.querySelector(
        `[data-tile-index="${focusedIndex}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.focus?.({ preventScroll: true });
        el.scrollIntoView({ block: "nearest" });
      }
      return !!el;
    };
    if (!focusEl()) {
      const id = setTimeout(focusEl, 80);
      return () => clearTimeout(id);
    }
  }, [focusedIndex, getScrollContainer]);

  return (
    <div ref={containerRef} className="p-6 space-y-3">
      <PageHeader
        icon={Images}
        title={
          filters.quarantined
            ? "Quarantined Images"
            : filters.groupId
              ? "Batch Images"
              : filters.libraryId
                ? (libs.find((l) => l._id === filters.libraryId)?.name ??
                  libs.find((l) => l._id === filters.libraryId)?.path ??
                  "Library Images")
                : hasActiveFilter(filters)
                  ? "Filtered Images"
                  : "All Images"
        }
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
            active={filters.group && !filters.groupId}
            onClick={() =>
              setFilters({
                ...filters,
                group: !filters.group,
                groupId: undefined,
              })
            }
            aria-label={filters.group ? "Ungroup batches" : "Group batches"}
            title="Group batches (same prompt + workflow)"
          >
            <Layers size={18} />
          </Button>
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

            {/* Generation-metadata search */}
            <div className="mt-3 pt-3 border-t border-neutral-800 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Generation
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Prompt contains
                  </label>
                  <TagSearchInput
                    value={filters.promptTerms}
                    onChange={(promptTerms) =>
                      setFilters({ ...filters, promptTerms })
                    }
                    suggestions={[]}
                    placeholder="Prompt terms…"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Prompt logic
                  </label>
                  <Select
                    aria-label="Prompt term logic"
                    value={filters.promptLogic}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        promptLogic: e.target.value as Filters["promptLogic"],
                      })
                    }
                  >
                    <option value="and">Match all terms (AND)</option>
                    <option value="or">Match any term (OR)</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Model
                  </label>
                  <Select
                    aria-label="Model filter"
                    value={filters.model || ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        model: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Any model</option>
                    {modelOptions.map((m) => (
                      <option key={m.model} value={m.model}>
                        {m.model} ({m.count})
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Width (min / max)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      aria-label="Min width"
                      placeholder="min"
                      value={filters.minW ?? ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          minW: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                    <Input
                      type="number"
                      aria-label="Max width"
                      placeholder="max"
                      value={filters.maxW ?? ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          maxW: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Height (min / max)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      aria-label="Min height"
                      placeholder="min"
                      value={filters.minH ?? ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          minH: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                    <Input
                      type="number"
                      aria-label="Max height"
                      placeholder="max"
                      value={filters.maxH ?? ""}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          maxH: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {!activeFeed.isLoading && items.length === 0 && (
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

      {filters.groupId && (
        <button
          onClick={() =>
            setFilters({ ...filters, groupId: undefined, group: true })
          }
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm bg-neutral-800 border border-neutral-700 hover:border-neutral-600"
        >
          <ArrowLeft size={14} /> Back to batches
        </button>
      )}

      {items.length > 0 && (
        <GalleryGrid
          items={items}
          selection={selection}
          onToggle={toggleSelection}
          onOpen={openTile}
          getScrollContainer={getScrollContainer}
          selectionMode={selectionMode}
          focusedIndex={focusedIndex}
        />
      )}

      <div ref={sentinelRef} className="h-8" />
    </div>
  );
}
