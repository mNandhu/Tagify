// Generation metadata + curation as the frontend sees them. The structured
// `gen.*` fields are extracted server-side (see services/gen_metadata.py); copy
// of the original workflow is fetched on demand from the cold raw collection.

export type GenMeta = {
  source?: string | null;
  workflow_sig?: string | null;
  prompt?: string | null;
  negative?: string | null;
  seed?: number | null;
  model?: string | null;
  sampler?: string | null;
  steps?: number | null;
  cfg?: number | null;
  prompt_terms?: string[];
  group_id?: string | null;
};

export type WorkflowPayload =
  | { source: "comfyui"; workflow: unknown; prompt: unknown }
  | { source: "a1111"; parameters: string }
  | { source?: string | null };

async function postJson(url: string, body: unknown): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

export function setScore(id: string, score: number): Promise<void> {
  return postJson(`/api/images/${encodeURIComponent(id)}/score`, { score });
}

export function setQuarantine(id: string, quarantined: boolean): Promise<void> {
  return postJson(`/api/images/${encodeURIComponent(id)}/quarantine`, {
    quarantined,
  });
}

export function purgeImage(id: string): Promise<void> {
  return postJson(`/api/images/${encodeURIComponent(id)}/purge`, {
    confirm: true,
  });
}

// --- Extraction rules (v2) ---------------------------------------------------

export const RULE_FIELDS = [
  "prompt",
  "negative",
  "seed",
  "model",
  "sampler",
  "steps",
  "cfg",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export type RuleFields = Partial<Record<RuleField, string[]>>;

export type Ruleset = { _id: string; fields: RuleFields; updated_at?: number };

export type SignatureRow = {
  workflow_sig: string;
  count: number;
  needs_mapping: number;
  sample_image_id: string;
  has_ruleset: boolean;
};

export type PreviewResult = {
  gen: GenMeta | null;
  paths: Partial<
    Record<RuleField, Array<{ path: string; raw: unknown; coerced: unknown }>>
  >;
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as T;
}

export function fetchSignatures(q?: string): Promise<SignatureRow[]> {
  const term = (q ?? "").trim();
  const url = term
    ? `/api/rules/signatures?q=${encodeURIComponent(term)}`
    : "/api/rules/signatures";
  return getJson<SignatureRow[]>(url);
}

export function fetchRuleset(sig: string): Promise<Ruleset> {
  return getJson<Ruleset>(`/api/rules/${encodeURIComponent(sig)}`);
}

export async function saveRuleset(
  sig: string,
  fields: RuleFields,
): Promise<Ruleset> {
  const r = await fetch(`/api/rules/${encodeURIComponent(sig)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as Ruleset;
}

export async function deleteRuleset(sig: string): Promise<void> {
  const r = await fetch(`/api/rules/${encodeURIComponent(sig)}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function previewRuleset(
  sampleImageId: string,
  fields: RuleFields,
): Promise<PreviewResult> {
  const r = await fetch(`/api/rules/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sample_image_id: sampleImageId, fields }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as PreviewResult;
}

export async function fetchWorkflow(id: string): Promise<WorkflowPayload> {
  const r = await fetch(`/api/images/${encodeURIComponent(id)}/workflow`);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as WorkflowPayload;
}

/** The clipboard string for copy-workflow / remix, format-aware:
 *  ComfyUI → the UI `workflow` graph JSON (drops onto the canvas);
 *  A1111   → the `parameters` string (pastes into the prompt box). */
export function workflowClipboardText(p: WorkflowPayload): string | null {
  if (!p || !p.source) return null;
  if (p.source === "comfyui") {
    const wf = (p as { workflow?: unknown }).workflow;
    const pr = (p as { prompt?: unknown }).prompt;
    const payload = wf ?? pr;
    return payload != null ? JSON.stringify(payload) : null;
  }
  if (p.source === "a1111") {
    return (p as { parameters?: string }).parameters ?? null;
  }
  return null;
}
