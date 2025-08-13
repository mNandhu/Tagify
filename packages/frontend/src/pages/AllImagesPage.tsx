import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { GalleryGrid } from "../components/GalleryGrid";

type ImageDoc = { _id: string; thumb_rel?: string; path: string };
type Library = { _id: string; name?: string; path: string };

type Filters = {
  q: string;
  tags: string[];
  logic: "and" | "or";
  libraryId?: string;
};

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function AllImagesPage() {
  const [items, setItems] = useState<ImageDoc[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [libs, setLibs] = useState<Library[]>([]);
  const [filters, setFilters] = useState<Filters>({
    q: "",
    tags: [],
    logic: "and",
  });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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
    p.set("offset", String(offset));
    p.set("limit", String(limit));
    return p.toString();
  }, [filters, offset]);

  // initial load and when filters or pagination change
  useEffect(() => {
    const url = `/api/images${queryString ? `?${queryString}` : ""}`;
    setLoading(true);
    api<ImageDoc[]>(url)
      .then((data) => {
        setItems((prev) => (offset === 0 ? data : [...prev, ...data]));
        setHasMore(data.length === limit);
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [queryString]);

  // sync filters from URL on mount and whenever search params change
  useEffect(() => {
    const sp = new URLSearchParams(searchParams);
    const urlTags = sp.getAll("tags");
    const singleTag = sp.getAll("tag");
    const lib = sp.get("library_id") || undefined;
    const logic = (sp.get("logic") as Filters["logic"]) || undefined;
    const nextTags = urlTags.length ? urlTags : singleTag;
    if (nextTags.length || lib || logic) {
      setFilters((f) => ({
        ...f,
        tags: nextTags.length ? nextTags : f.tags,
        libraryId: lib,
        logic: logic || f.logic,
      }));
      if (singleTag.length) {
        singleTag.forEach(() => sp.delete("tag"));
        nextTags.forEach((t) => sp.append("tags", t));
        setSearchParams(sp, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  // push filters to URL when they change (excluding offset)
  useEffect(() => {
    const sp = new URLSearchParams();
    filters.tags.forEach((t) => sp.append("tags", t));
    if (filters.logic) sp.set("logic", filters.logic);
    if (filters.libraryId) sp.set("library_id", filters.libraryId);
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
    setOffset(0);
  };

  const toggleSelection = (id: string) =>
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const clearSelection = () => setSelection(new Set());
  const selectionActive = selection.size > 0;

  // when turning off selection mode, clear current selection
  useEffect(() => {
    if (!selectionMode && selectionActive) {
      setSelection(new Set());
    }
  }, [selectionMode]);

  // observe sentinel for infinite scroll
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setOffset((o) => o + limit);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          {filtersOpen ? "Hide Filters" : "Show Filters"}
        </button>
        <form onSubmit={onSubmitSearch} className="flex-1">
          <input
            className="px-3 py-2 rounded bg-neutral-900 border border-neutral-800 w-full"
            placeholder="Search tags… (comma separated)"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
        </form>
        <button
          className={
            "px-3 py-2 rounded border " +
            (selectionMode
              ? "bg-purple-700 border-purple-600"
              : "bg-neutral-800 hover:bg-neutral-700 border-neutral-700")
          }
          onClick={() => setSelectionMode((v) => !v)}
        >
          {selectionMode ? "Done Selecting" : "Select"}
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
          <div className="flex items-end gap-2">
            <button
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
              onClick={() =>
                setFilters({
                  q: "",
                  tags: [],
                  logic: "and",
                  libraryId: undefined,
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
      )}

      <GalleryGrid
        items={items}
        selection={selection}
        onToggle={toggleSelection}
        onOpen={(id) => {
          const sp = new URLSearchParams();
          filters.tags.forEach((t) => sp.append("tags", t));
          if (filters.logic) sp.set("logic", filters.logic);
          if (filters.libraryId) sp.set("library_id", filters.libraryId);
          sp.set("offset", String(offset));
          sp.set("limit", String(limit));
          navigate(`/image/${encodeURIComponent(id)}?${sp.toString()}`);
        }}
        selectionMode={selectionMode}
      />

      <div ref={sentinelRef} className="h-8" />
    </div>
  );
}
