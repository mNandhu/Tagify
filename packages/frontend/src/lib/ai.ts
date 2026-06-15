// AI tagging domain: the Tagger/Model lifecycle, AI Jobs, and AI Settings as
// the frontend sees them. Status predicates are pure (the test surface); the
// polling cadence that used to be hand-rolled in three places now derives from
// them. See CONTEXT.md › AI Job, Tagger / Model, AI Settings.

export type AISettings = {
  model_repo: string;
  general_thresh: number;
  character_thresh: number;
  general_mcut: boolean;
  character_mcut: boolean;
  max_general: number;
  max_character: number;
  idle_unload_s: number;
  cache_dir: string;
  prompt_positive_only: boolean;
};

/** A single failure recorded while an AI Job processed one image. */
export type AiJobError = { image_id: string; error: string };

export type AiJob = {
  id: string;
  created_at: number;
  status: string;
  total: number;
  done: number;
  failed: number;
  skipped?: number;
  current?: string | null;
  errors?: AiJobError[];
};

export type AIStatus = {
  model: {
    loaded: boolean;
    repo?: string | null;
    last_used?: number;
    idle_unload_s?: number;
  };
  model_load?: {
    status: string;
    error?: string | null;
    loading_for?: [string, string] | null;
    available?: boolean;
  };
  model_download?: {
    status: string;
    cancel_requested?: boolean;
    error?: string | null;
    files?: Array<{
      name: string;
      status: string;
      downloaded: number;
      total?: number | null;
      error?: string | null;
    }>;
  };
  jobs: { recent: AiJob[]; queue_depth: number };
  settings: AISettings;
};

const TERMINAL = new Set(["done", "error", "cancelled"]);
const ACTIVE = new Set(["queued", "running", "cancelling"]);

/** An AI Job in a terminal state no longer needs polling. */
export function isTerminalJob(status: string | undefined | null): boolean {
  return !!status && TERMINAL.has(status);
}

/** An AI Job still doing work (poll faster, allow cancel). */
export function isActiveJob(status: string | undefined | null): boolean {
  return !!status && ACTIVE.has(status);
}

/**
 * Whether the AI subsystem is doing anything that warrants a faster poll:
 * a model loading/downloading, or any recent job still active.
 */
export function isStatusBusy(s: AIStatus | undefined | null): boolean {
  if (!s) return false;
  return (
    s.model_load?.status === "loading" ||
    s.model_download?.status === "downloading" ||
    (s.jobs?.recent ?? []).some((j) => isActiveJob(j.status))
  );
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

export function fetchAiStatus(signal?: AbortSignal): Promise<AIStatus> {
  return getJson<AIStatus>("/api/ai/status", signal);
}

export function fetchAiJob(id: string, signal?: AbortSignal): Promise<AiJob> {
  return getJson<AiJob>(`/api/ai/jobs/${encodeURIComponent(id)}`, signal);
}

/** Queue an AI tagging job for the given image ids; returns the job id. */
export async function postAiTag(ids: string[]): Promise<{ job_id: string }> {
  const r = await fetch(`/api/ai/tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ job_id: string }>;
}

/** Request cancellation of an AI tagging job. Returns whether the backend
 * accepted the request (false if the job already finished). */
export async function postAiJobCancel(id: string): Promise<{ ok: boolean }> {
  const r = await fetch(`/api/ai/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ ok: boolean }>;
}
