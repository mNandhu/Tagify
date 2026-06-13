// Image filter — the criteria selecting which Images the gallery shows, plus
// its pure URL round-trip. parseFilters / serializeFilters are the single
// source of truth so the URL and the Image feed query never drift.
//
// See CONTEXT.md › Frontend › Image filter.

export type ImageDoc = {
  _id: string;
  path: string;
  width?: number;
  height?: number;
  size?: number;
  tags?: string[];
  rating?: string;
  ai?: {
    rating?: Record<string, number>;
  };
};

export type TagLogic = "and" | "or";

export type Filters = {
  tags: string[];
  logic: TagLogic;
  libraryId?: string;
  noTags: boolean;
  noAiTags: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  tags: [],
  logic: "and",
  libraryId: undefined,
  noTags: false,
  noAiTags: false,
};

/** Default page size for the Image feed. */
export const PAGE_LIMIT = 100;

/**
 * Read an Image filter out of URL search params.
 *
 * Back-compat: accepts the legacy singular `tag` param as well as `tags`.
 * serializeFilters always emits `tags`, so simply re-pushing a parsed filter
 * migrates a legacy URL — no separate migration step needed.
 */
export function parseFilters(sp: URLSearchParams): Filters {
  const tags = sp.getAll("tags");
  const legacy = sp.getAll("tag");
  const logic = sp.get("logic");
  return {
    tags: tags.length ? tags : legacy,
    logic: logic === "or" ? "or" : "and",
    libraryId: sp.get("library_id") || undefined,
    noTags: sp.get("no_tags") === "1",
    noAiTags: sp.get("no_ai_tags") === "1",
  };
}

/**
 * Serialize an Image filter to URL search params (filter params only — no
 * pagination cursor/limit). Used both for pushing the gallery URL and for
 * carrying the filter when navigating to ImageView.
 */
export function serializeFilters(filters: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  filters.tags.forEach((t) => sp.append("tags", t));
  if (filters.logic) sp.set("logic", filters.logic);
  if (filters.libraryId) sp.set("library_id", filters.libraryId);
  if (filters.noTags) sp.set("no_tags", "1");
  if (filters.noAiTags) sp.set("no_ai_tags", "1");
  return sp;
}

/**
 * Build the `/api/images` query string for one page of the Image feed:
 * the filter params plus pagination (limit, optional cursor).
 */
export function buildImagesQuery(
  filters: Filters,
  opts: { cursor?: string | null; limit?: number } = {},
): string {
  const sp = serializeFilters(filters);
  sp.set("limit", String(opts.limit ?? PAGE_LIMIT));
  if (opts.cursor) sp.set("cursor", opts.cursor);
  return sp.toString();
}

/** Cursor for the page after `page` — the last item's id, or null when empty. */
export function nextCursorOf(page: ImageDoc[]): string | null {
  return page.length ? page[page.length - 1]._id : null;
}

/** Fetch one page of the Image feed. Throws on non-OK response. */
export async function fetchImagesPage(
  filters: Filters,
  opts: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<ImageDoc[]> {
  const qs = buildImagesQuery(filters, opts);
  const r = await fetch(`/api/images?${qs}`, { signal: opts.signal });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as ImageDoc[];
}

/** Fetch a single Image document by id. Throws on non-OK response. */
export async function fetchImage(
  id: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ImageDoc> {
  const r = await fetch(`/api/images/${encodeURIComponent(id)}`, {
    signal: opts.signal,
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as ImageDoc;
}
