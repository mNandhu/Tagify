// Tag-suggestion shaping for the gallery search dropdown. Same-text tags from
// different sources (AI `cat`, `manual:cat`, `prompt:cat`) collapse into one
// cross-source `any:cat` entry so the user sees a single row, not three. The
// `any:` id is a query marker the backend expands back to all sources.

import type { TagSuggestion } from "../components/TagSearchInput";

/** Strip a tag's source prefix to its bare text, so AI `cat`, `manual:cat` and
 * `prompt:cat` share one base. */
export const tagBase = (raw: string): string =>
  raw.startsWith("manual:") || raw.startsWith("prompt:") ? raw.slice(7) : raw;

/**
 * Collapse same-text suggestions from different sources into one cross-source
 * `any:<base>` entry (counts summed), sorted by count descending. The count is
 * an upper bound — an image tagged from two sources is counted twice.
 */
export function mergeTagSuggestions(raw: TagSuggestion[]): TagSuggestion[] {
  const byBase = new Map<string, number>();
  for (const s of raw) {
    const base = tagBase(s._id);
    if (!base) continue;
    byBase.set(base, (byBase.get(base) ?? 0) + s.count);
  }
  return Array.from(byBase, ([base, count]) => ({ _id: `any:${base}`, count }))
    .sort((a, b) => b.count - a.count);
}
