import { useEffect, useMemo, useState } from "react";
import { useToast } from "../components/Toasts";

type AISettings = {
  model_repo: string;
  general_thresh: number;
  character_thresh: number;
  general_mcut: boolean;
  character_mcut: boolean;
  max_general: number;
  max_character: number;
  idle_unload_s: number;
  cache_dir: string;
};

type AIJob = {
  id: string;
  created_at: number;
  status: string;
  total: number;
  done: number;
  failed: number;
  skipped?: number;
  current?: string | null;
};

type AIStatus = {
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
  jobs: { recent: AIJob[]; queue_depth: number };
  settings: AISettings;
};

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function SettingsPage() {
  const { push } = useToast();
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [untaggedLimit, setUntaggedLimit] = useState(200);

  const isModelLoaded = Boolean(status?.model?.loaded);
  const isModelLoading = status?.model_load?.status === "loading";

  // Initial load
  useEffect(() => {
    api<AISettings>("/api/ai/settings")
      .then(setSettings)
      .catch((e) => push(`Failed to load AI settings: ${String(e)}`, "error"));
  }, [push]);

  // Poll status for progress/model state
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api<AIStatus>("/api/ai/status");
        if (!alive) return;
        setStatus(s);
        // Keep local settings in sync if user hasn't loaded yet
        setSettings((prev) => prev ?? s.settings);
      } catch {
        // ignore transient errors
      }
    };
    tick();
    const t = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const latestJob = useMemo(() => {
    const j = status?.jobs?.recent?.[0];
    return j || null;
  }, [status]);

  const cancelJob = async (jobId: string) => {
    setRunning(true);
    try {
      const r = await api<{ ok: boolean }>(
        `/api/ai/jobs/${encodeURIComponent(jobId)}/cancel`,
        { method: "POST" }
      );
      push(
        r.ok ? "Cancellation requested" : "Could not cancel job",
        r.ok ? "success" : "error"
      );
    } catch (e) {
      push(`Failed to cancel: ${String(e)}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const progressPct = useMemo(() => {
    if (!latestJob || !latestJob.total) return 0;
    return Math.min(
      100,
      Math.round(((latestJob.done + latestJob.failed) / latestJob.total) * 100)
    );
  }, [latestJob]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await api<AISettings>("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSettings(next);
      push("Saved AI settings", "success");
    } catch (e) {
      push(`Failed to save: ${String(e)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const loadModel = async () => {
    setRunning(true);
    try {
      const r = await api<{ started: boolean }>("/api/ai/model/load", {
        method: "POST",
      });
      push(
        r.started ? "Model load started" : "Model already loading/loaded",
        "info"
      );
    } catch (e) {
      push(`Failed to load model: ${String(e)}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const cancelModelLoad = async () => {
    setRunning(true);
    try {
      const r = await api<{ ok: boolean }>("/api/ai/model/load-cancel", {
        method: "POST",
      });
      push(
        r.ok ? "Cancelled model load" : "Nothing to cancel",
        r.ok ? "success" : "info"
      );
    } catch (e) {
      push(`Failed to cancel load: ${String(e)}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const cancelModelDownload = async () => {
    setRunning(true);
    try {
      const r = await api<{ ok: boolean }>("/api/ai/model/download-cancel", {
        method: "POST",
      });
      push(
        r.ok ? "Cancelled download" : "Nothing to cancel",
        r.ok ? "success" : "info"
      );
    } catch (e) {
      push(`Failed to cancel download: ${String(e)}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const unloadModel = async () => {
    setRunning(true);
    try {
      await api("/api/ai/model/unload", { method: "POST" });
      push("Model unloaded", "success");
    } catch (e) {
      push(`Failed to unload model: ${String(e)}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const runUntagged = async () => {
    setRunning(true);
    try {
      const r = await api<{ job_id: string | null; queued: number }>(
        "/api/ai/tag-untagged",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: untaggedLimit }),
        }
      );
      if (!r.queued) {
        push("No images are missing AI tags", "info");
        return;
      }
      push(`Queued AI tagging for ${r.queued} images`, "success");
    } catch (e) {
      push(`Failed to start job: ${String(e)}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const clearAllAiTags = async () => {
    const ok = confirm(
      "This will REMOVE all AI-generated tags and AI metadata from ALL images across ALL libraries.\n\nManual tags (manual:) will be kept.\n\nContinue?"
    );
    if (!ok) return;

    setRunning(true);
    try {
      const r = await api<{ matched: number; modified: number }>(
        "/api/ai/clear-ai-tags",
        { method: "POST" }
      );
      push(`Cleared AI tags on ${r.modified} images`, "success");
    } catch (e) {
      push(`Failed to clear AI tags: ${String(e)}`, "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-neutral-400 text-sm">
          Internal AI tagging (wd-tagger via ONNX Runtime).
        </p>
      </div>

      <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Model</div>
            <div className="text-xs text-neutral-400">
              Status: {status?.model?.loaded ? "loaded" : "unloaded"}
              {status?.model?.repo ? ` · ${status.model.repo}` : ""}
            </div>
            {status?.model_load?.status &&
              status.model_load.status !== "idle" && (
                <div className="text-xs text-neutral-500 mt-1">
                  Load state: {status.model_load.status}
                  {status.model_load.error ? (
                    <span className="text-red-300">
                      {" "}
                      · {status.model_load.error}
                    </span>
                  ) : null}
                </div>
              )}
          </div>
          <div className="flex gap-2">
            {!isModelLoaded && !isModelLoading && (
              <button
                className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
                onClick={loadModel}
                disabled={running}
              >
                Load
              </button>
            )}

            {isModelLoading && (
              <button
                className="px-3 py-2 rounded bg-red-600/20 hover:bg-red-600/30 border border-red-700 text-red-200 disabled:opacity-50"
                onClick={cancelModelLoad}
                disabled={running}
                title="Stops an in-progress download/load."
              >
                Stop
              </button>
            )}

            {isModelLoaded && !isModelLoading && (
              <button
                className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
                onClick={unloadModel}
                disabled={running}
              >
                Unload
              </button>
            )}
          </div>
        </div>

        {status?.model_download?.status === "downloading" && (
          <div className="rounded border border-neutral-800 bg-neutral-950/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm">
                Downloading model files…
                {status.model_download.cancel_requested ? (
                  <span className="text-neutral-500"> (cancelling)</span>
                ) : null}
              </div>
              <button
                className="px-2 py-1 rounded bg-red-600/20 hover:bg-red-600/30 border border-red-700 text-red-200 text-xs disabled:opacity-50"
                onClick={cancelModelDownload}
                disabled={running}
                title="Cancel the current download (partial files will be removed)."
              >
                Cancel download
              </button>
            </div>

            {(status.model_download.files || []).map((f) => {
              const pct =
                f.total && f.total > 0
                  ? Math.min(100, Math.round((f.downloaded / f.total) * 100))
                  : 0;
              return (
                <div key={f.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-neutral-400">
                    <div>
                      <span className="font-mono">{f.name}</span> · {f.status}
                      {f.error ? (
                        <span className="text-red-300"> · {f.error}</span>
                      ) : null}
                    </div>
                    <div className="text-neutral-500">
                      {formatBytes(f.downloaded)}
                      {f.total ? ` / ${formatBytes(f.total)}` : ""}
                    </div>
                  </div>
                  <progress
                    className="w-full h-2 [&::-webkit-progress-bar]:bg-neutral-800 [&::-webkit-progress-value]:bg-emerald-600 [&::-moz-progress-bar]:bg-emerald-600"
                    value={pct}
                    max={100}
                  />
                </div>
              );
            })}
          </div>
        )}

        {settings && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ai_model_repo" className="block text-sm mb-1">
                Model repo
              </label>
              <input
                id="ai_model_repo"
                className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800 w-full"
                value={settings.model_repo}
                onChange={(e) =>
                  setSettings({ ...settings, model_repo: e.target.value })
                }
                placeholder="SmilingWolf/wd-vit-tagger-v3"
              />
            </div>
            <div>
              <label htmlFor="ai_idle_unload" className="block text-sm mb-1">
                Idle unload (seconds)
              </label>
              <input
                id="ai_idle_unload"
                type="number"
                className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800 w-full"
                value={settings.idle_unload_s}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    idle_unload_s: Number(e.target.value),
                  })
                }
                min={0}
              />
              <div className="text-xs text-neutral-500 mt-1">
                0 disables auto-unload.
              </div>
            </div>
            <div>
              <label htmlFor="ai_general_thresh" className="block text-sm mb-1">
                General threshold
              </label>
              <input
                id="ai_general_thresh"
                type="number"
                step="0.01"
                className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800 w-full"
                value={settings.general_thresh}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    general_thresh: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label
                htmlFor="ai_character_thresh"
                className="block text-sm mb-1"
              >
                Character threshold
              </label>
              <input
                id="ai_character_thresh"
                type="number"
                step="0.01"
                className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800 w-full"
                value={settings.character_thresh}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    character_thresh: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="ai_max_general" className="block text-sm mb-1">
                Max general tags
              </label>
              <input
                id="ai_max_general"
                type="number"
                className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800 w-full"
                value={settings.max_general}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    max_general: Number(e.target.value),
                  })
                }
                min={0}
              />
            </div>
            <div>
              <label htmlFor="ai_max_character" className="block text-sm mb-1">
                Max character tags
              </label>
              <input
                id="ai_max_character"
                type="number"
                className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800 w-full"
                value={settings.max_character}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    max_character: Number(e.target.value),
                  })
                }
                min={0}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="general_mcut"
                type="checkbox"
                checked={settings.general_mcut}
                onChange={(e) =>
                  setSettings({ ...settings, general_mcut: e.target.checked })
                }
              />
              <label
                htmlFor="general_mcut"
                className="text-sm"
                title="MCUT auto-picks a threshold by finding the biggest drop between sorted tag scores. Useful when a fixed threshold is too strict/too loose for a given image."
              >
                General MCUT
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="character_mcut"
                type="checkbox"
                checked={settings.character_mcut}
                onChange={(e) =>
                  setSettings({ ...settings, character_mcut: e.target.checked })
                }
              />
              <label
                htmlFor="character_mcut"
                className="text-sm"
                title="MCUT for character tags: auto-picks a threshold from the score distribution (largest drop). Helpful when character tags are missing or noisy."
              >
                Character MCUT
              </label>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="ai_cache_dir" className="block text-sm mb-1">
                Model cache dir
              </label>
              <input
                id="ai_cache_dir"
                className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800 w-full"
                value={settings.cache_dir}
                onChange={(e) =>
                  setSettings({ ...settings, cache_dir: e.target.value })
                }
              />
              <div className="text-xs text-neutral-500 mt-1">
                Relative to backend working directory.
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
            onClick={save}
            disabled={!settings || saving}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </section>

      <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="font-semibold">Run AI Tagging</div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="ai_untagged_limit" className="block text-sm mb-1">
              Untagged-by-AI limit
            </label>
            <input
              id="ai_untagged_limit"
              type="number"
              className="px-3 py-2 rounded bg-neutral-950/70 border border-neutral-800"
              value={untaggedLimit}
              onChange={(e) => setUntaggedLimit(Number(e.target.value))}
              min={1}
              max={5000}
            />
          </div>
          <button
            className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
            onClick={runUntagged}
            disabled={running}
          >
            Tag un-AI-tagged images
          </button>
        </div>

        <div className="pt-2 border-t border-neutral-800 flex flex-wrap items-center gap-2">
          <button
            className="px-3 py-2 rounded bg-red-600/20 hover:bg-red-600/30 border border-red-700 text-red-200 disabled:opacity-50"
            onClick={clearAllAiTags}
            disabled={running}
            title="Removes AI tags and AI metadata from every image. Keeps manual: tags."
          >
            Clear ALL AI tags (all libraries)
          </button>
          <div className="text-xs text-neutral-500">
            Use this if you want to re-run AI tagging from scratch.
          </div>
        </div>

        {latestJob && (
          <div className="space-y-2">
            <div className="text-sm text-neutral-300">
              Latest job:{" "}
              <span
                className="font-mono"
                title="Job ID: used to track progress (polling), debug issues, and cancel jobs"
              >
                {latestJob.id.slice(0, 8)}
              </span>{" "}
              · {latestJob.status} · {latestJob.done + latestJob.failed}/
              {latestJob.total}
              {typeof latestJob.skipped === "number" &&
              latestJob.skipped > 0 ? (
                <span className="text-neutral-500">
                  {" "}
                  · {latestJob.skipped} skipped
                </span>
              ) : null}
            </div>
            <progress
              className="w-full h-2 [&::-webkit-progress-bar]:bg-neutral-800 [&::-webkit-progress-value]:bg-purple-600 [&::-moz-progress-bar]:bg-purple-600"
              value={progressPct}
              max={100}
            />
            {latestJob.current && (
              <div className="text-xs text-neutral-500 truncate">
                Current: {latestJob.current}
              </div>
            )}

            {(latestJob.status === "queued" ||
              latestJob.status === "running" ||
              latestJob.status === "cancelling") && (
              <div>
                <button
                  className="px-3 py-2 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50"
                  onClick={() => cancelJob(latestJob.id)}
                  disabled={running}
                >
                  Cancel latest job
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-2">
        <div className="font-semibold">Recent jobs</div>
        <div className="space-y-2">
          {(status?.jobs?.recent || []).map((j) => (
            <div
              key={j.id}
              className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-2 flex items-center justify-between"
            >
              <div className="text-sm">
                <span
                  className="font-mono"
                  title="Job ID: used to track progress (polling), debug issues, and cancel jobs"
                >
                  {j.id.slice(0, 8)}
                </span>
                <span className="text-neutral-500"> · {j.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-neutral-400">
                  {j.done + j.failed}/{j.total}
                  {typeof j.skipped === "number" && j.skipped > 0 ? (
                    <span className="text-neutral-500">
                      {" "}
                      · {j.skipped} skipped
                    </span>
                  ) : null}
                  {j.failed ? (
                    <span className="text-red-300"> · {j.failed} failed</span>
                  ) : null}
                </div>
                {(j.status === "queued" ||
                  j.status === "running" ||
                  j.status === "cancelling") && (
                  <button
                    className="px-2 py-1 rounded bg-red-600/20 hover:bg-red-600/30 border border-red-700 text-red-200 text-xs disabled:opacity-50"
                    onClick={() => cancelJob(j.id)}
                    disabled={running}
                    title="Cancel job"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
          {!status?.jobs?.recent?.length && (
            <div className="text-sm text-neutral-500">No jobs yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
