/**
 * The three tag kinds as the frontend sees them. One `tags` array holds all
 * three: AI tags unprefixed (`1girl`), manual tags `manual:`-prefixed, prompt
 * tags `prompt:`-prefixed. Mirror of the backend's image_tags prefix helpers —
 * see CONTEXT.md › Tag.
 *
 * The prefixes were hardcoded in five places (this module, TagSearchInput,
 * TagsPage, ImageView and OverviewPage), each re-deriving the same three
 * predicates. They live here once.
 */

export const MANUAL_PREFIX = "manual:";
export const PROMPT_PREFIX = "prompt:";
/** The merged cross-source entry the gallery search emits (backend ANY_PREFIX). */
export const ANY_PREFIX = "any:";

export function isManual(raw: string): boolean {
  return raw.startsWith(MANUAL_PREFIX);
}

export function isPrompt(raw: string): boolean {
  return raw.startsWith(PROMPT_PREFIX);
}

/** AI tags are the unprefixed kind — neither manual nor prompt. */
export function isAiTag(raw: string): boolean {
  return !isManual(raw) && !isPrompt(raw);
}

/** Strip the kind prefix from a stored tag for display. */
export function formatTag(raw: string): string {
  if (isManual(raw)) return raw.slice(MANUAL_PREFIX.length);
  if (isPrompt(raw)) return raw.slice(PROMPT_PREFIX.length);
  return raw;
}

/**
 * Display form for a tag that may also be a merged `any:` search entry. Only
 * the gallery search deals in `any:`; everywhere else uses formatTag.
 */
export function formatSearchTag(raw: string): string {
  if (raw.startsWith(ANY_PREFIX)) return raw.slice(ANY_PREFIX.length);
  return formatTag(raw);
}

export type PartitionedTags = {
  /** Unprefixed AI tags. */
  ai: string[];
  /** Raw `manual:`-prefixed tags (still prefixed — format for display). */
  manual: string[];
  /** Raw `prompt:`-prefixed tags. */
  prompt: string[];
};

/**
 * Split one `tags` array into its three kinds, preserving order within each.
 * AI and prompt tags may overlap (`1girl` and `prompt:1girl` coexist) — they
 * are distinct kinds and are never deduped against each other.
 */
export function partitionTags(tags: readonly string[] = []): PartitionedTags {
  const out: PartitionedTags = { ai: [], manual: [], prompt: [] };
  for (const t of tags) {
    if (isManual(t)) out.manual.push(t);
    else if (isPrompt(t)) out.prompt.push(t);
    else out.ai.push(t);
  }
  return out;
}
