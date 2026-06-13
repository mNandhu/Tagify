import { useEffect, useMemo, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useToast } from "../components/Toasts";
import { useAiStatus } from "../hooks/useAiStatus";
import { isActiveJob, type AISettings } from "../lib/ai";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Field } from "../components/ui/Input";
import { Checkbox } from "../components/ui/Checkbox";

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
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [untaggedLimit, setUntaggedLimit] = useState(200);

  // AI status is a shared polled query; cadence derives from isStatusBusy.
  const { data: status } = useAiStatus();

  const isModelLoaded = Boolean(status?.model?.loaded);
  const isModelLoading = status?.model_load?.status === "loading";

  // Initial load
  useEffect(() => {
    api<AISettings>("/api/ai/settings")
      .then(setSettings)
      .catch((e) => push(`Failed to load AI settings: ${String(e)}`, "error"));
  }, [push]);

  // Seed the editable form from polled status until the user's copy loads.
  useEffect(() => {
    if (status?.settings) setSettings((prev) => prev ?? status.settings);
  }, [status?.settings]);

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
    <div className="p-6 space-y-6">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        description="Internal AI tagging (wd-tagger via ONNX Runtime)."
      />

      <Card className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold flex items-center gap-2">
              Model
              <Badge tone={status?.model?.loaded ? "success" : "neutral"}>
                {status?.model?.loaded ? "loaded" : "unloaded"}
              </Badge>
            </div>
            <div className="text-xs text-neutral-400">
              {status?.model?.repo ? status.model.repo : ""}
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
              <Button onClick={loadModel} disabled={running}>
                Load
              </Button>
            )}

            {isModelLoading && (
              <Button
                variant="dangerSoft"
                onClick={cancelModelLoad}
                disabled={running}
                title="Stops an in-progress download/load."
              >
                Stop
              </Button>
            )}

            {isModelLoaded && !isModelLoading && (
              <Button onClick={unloadModel} disabled={running}>
                Unload
              </Button>
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
              <Button
                size="sm"
                variant="dangerSoft"
                onClick={cancelModelDownload}
                disabled={running}
                title="Cancel the current download (partial files will be removed)."
              >
                Cancel download
              </Button>
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
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <div className="font-semibold">AI tagging settings</div>
          <div className="text-xs text-neutral-400">
            How tags are scored and how many are kept per image.
          </div>
        </div>

        {settings ? (
          <div className="space-y-6">
            {/* Tagging output controls */}
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Tagging
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="General threshold" htmlFor="ai_general_thresh">
                  <Input
                    id="ai_general_thresh"
                    type="number"
                    step="0.01"
                    value={settings.general_thresh}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        general_thresh: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Character threshold" htmlFor="ai_character_thresh">
                  <Input
                    id="ai_character_thresh"
                    type="number"
                    step="0.01"
                    value={settings.character_thresh}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        character_thresh: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Max general tags" htmlFor="ai_max_general">
                  <Input
                    id="ai_max_general"
                    type="number"
                    min={0}
                    value={settings.max_general}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        max_general: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Max character tags" htmlFor="ai_max_character">
                  <Input
                    id="ai_max_character"
                    type="number"
                    min={0}
                    value={settings.max_character}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        max_character: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <Checkbox
                  id="general_mcut"
                  checked={settings.general_mcut}
                  onChange={(v) =>
                    setSettings({ ...settings, general_mcut: v })
                  }
                  label="General MCUT"
                  hint="Auto-pick the threshold from the biggest drop between sorted tag scores."
                />
                <Checkbox
                  id="character_mcut"
                  checked={settings.character_mcut}
                  onChange={(v) =>
                    setSettings({ ...settings, character_mcut: v })
                  }
                  label="Character MCUT"
                  hint="Same MCUT auto-threshold, applied to character tags."
                />
              </div>
            </div>

            {/* Model & storage */}
            <div className="space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Model &amp; storage
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Model repo" htmlFor="ai_model_repo">
                  <Input
                    id="ai_model_repo"
                    value={settings.model_repo}
                    onChange={(e) =>
                      setSettings({ ...settings, model_repo: e.target.value })
                    }
                    placeholder="SmilingWolf/wd-vit-tagger-v3"
                  />
                </Field>
                <Field
                  label="Idle unload (seconds)"
                  htmlFor="ai_idle_unload"
                  hint="0 disables auto-unload."
                >
                  <Input
                    id="ai_idle_unload"
                    type="number"
                    min={0}
                    value={settings.idle_unload_s}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        idle_unload_s: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Model cache dir"
                  htmlFor="ai_cache_dir"
                  hint="Relative to backend working directory."
                  className="md:col-span-2"
                >
                  <Input
                    id="ai_cache_dir"
                    value={settings.cache_dir}
                    onChange={(e) =>
                      setSettings({ ...settings, cache_dir: e.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-neutral-500">Loading settings…</div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="primary"
            onClick={save}
            disabled={!settings || saving}
          >
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="font-semibold">Run AI Tagging</div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Untagged-by-AI limit" htmlFor="ai_untagged_limit">
            <Input
              id="ai_untagged_limit"
              type="number"
              className="w-40"
              value={untaggedLimit}
              onChange={(e) => setUntaggedLimit(Number(e.target.value))}
              min={1}
              max={5000}
            />
          </Field>
          <Button variant="success" onClick={runUntagged} disabled={running}>
            Tag un-AI-tagged images
          </Button>
        </div>

        <div className="pt-2 border-t border-neutral-800 flex flex-wrap items-center gap-2">
          <Button
            variant="dangerSoft"
            onClick={clearAllAiTags}
            disabled={running}
            title="Removes AI tags and AI metadata from every image. Keeps manual: tags."
          >
            Clear ALL AI tags (all libraries)
          </Button>
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

            {isActiveJob(latestJob.status) && (
              <div>
                <Button
                  variant="danger"
                  onClick={() => cancelJob(latestJob.id)}
                  disabled={running}
                >
                  Cancel latest job
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-2">
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
                {isActiveJob(j.status) && (
                  <Button
                    size="sm"
                    variant="dangerSoft"
                    onClick={() => cancelJob(j.id)}
                    disabled={running}
                    title="Cancel job"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!status?.jobs?.recent?.length && (
            <div className="text-sm text-neutral-500">No jobs yet.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
