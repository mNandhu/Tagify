import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useToast } from "../../components/Toasts";
import { useAiStatus } from "../../hooks/useAiStatus";
import type { AISettings, AIStatus, AiJob } from "../../lib/ai";
import { api } from "../../lib/api";

export function formatBytes(n: number) {
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

type LatestJob = AiJob | null;

/**
 * All AI settings state + actions shared across settings sections.
 * Lives once so sections (Model, Tagging, Prompt tags, Jobs) read/write the
 * same `settings`/`status` without prop-threading. Independent future sections
 * (e.g. Appearance) are free to own local state and ignore this context.
 */
export type SettingsController = {
  settings: AISettings | null;
  setSettings: React.Dispatch<React.SetStateAction<AISettings | null>>;
  status: AIStatus | undefined;
  saving: boolean;
  running: boolean;
  isModelLoaded: boolean;
  isModelLoading: boolean;
  latestJob: LatestJob;
  progressPct: number;
  untaggedLimit: number;
  setUntaggedLimit: (n: number) => void;
  save: () => Promise<void>;
  loadModel: () => Promise<void>;
  cancelModelLoad: () => Promise<void>;
  cancelModelDownload: () => Promise<void>;
  unloadModel: () => Promise<void>;
  runUntagged: () => Promise<void>;
  clearAllAiTags: () => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
};

function useSettingsController(): SettingsController {
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

  const progressPct = useMemo(() => {
    if (!latestJob || !latestJob.total) return 0;
    return Math.min(
      100,
      Math.round(((latestJob.done + latestJob.failed) / latestJob.total) * 100)
    );
  }, [latestJob]);

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

  return {
    settings,
    setSettings,
    status,
    saving,
    running,
    isModelLoaded,
    isModelLoading,
    latestJob,
    progressPct,
    untaggedLimit,
    setUntaggedLimit,
    save,
    loadModel,
    cancelModelLoad,
    cancelModelDownload,
    unloadModel,
    runUntagged,
    clearAllAiTags,
    cancelJob,
  };
}

const Ctx = createContext<SettingsController | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const controller = useSettingsController();
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsController {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used within <SettingsProvider>");
  return v;
}
