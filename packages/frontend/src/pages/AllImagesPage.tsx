import { useEffect, useMemo, useState } from "react";
import { ImageThumbnail } from "../components/ImageThumbnail";

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
    return p.toString();
  }, [filters]);

  useEffect(() => {
    const url = `/api/images${queryString ? `?${queryString}` : ""}`;
    api<ImageDoc[]>(url)
      .then(setItems)
      .catch((e) => console.error(e));
  }, [queryString]);

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = filters.q
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setFilters((f) => ({ ...f, tags }));
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
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
      </div>

      {filtersOpen && (
        <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
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
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 w-full"
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
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {items.map((it) => (
          <ImageThumbnail
            key={it._id}
            src={it.thumb_rel ? `/api/thumbs/${it.thumb_rel}` : ""}
            alt={it.path}
          />
        ))}
      </div>
    </div>
  );
}
