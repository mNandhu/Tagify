import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "../components/Toasts";
import {
  fetchAiJob,
  isActiveJob,
  isTerminalJob,
  postAiJobCancel,
  postAiTag,
} from "../lib/ai";

const JOB_POLL_MS = 1500;

/**
 * Encapsulates tagging a set of images with AI: queue the job, poll it until a
 * terminal state, toast the outcome, and invoke `onTagged` so the caller can
 * refresh. The caller only calls `start(ids)` and reads `submitting` / `job`.
 *
 * This replaces the bespoke alive-flag/setTimeout/backoff poll loop that lived
 * inside ImageView's TagEditor.
 */
export function useAiTagging(onTagged?: () => void) {
  const { push } = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: job } = useQuery({
    queryKey: ["aiJob", jobId],
    queryFn: ({ signal }) => fetchAiJob(jobId!, signal),
    enabled: !!jobId,
    refetchInterval: (query) =>
      isTerminalJob(query.state.data?.status) ? false : JOB_POLL_MS,
  });

  // React to terminal transition: toast, refresh, clear the job.
  const handled = useRef<string | null>(null);
  const status = job?.status;
  useEffect(() => {
    if (!jobId || !isTerminalJob(status) || handled.current === jobId) return;
    handled.current = jobId;
    if (status === "done") {
      push("AI tagging completed", "success");
      onTagged?.();
    } else if (status === "error") {
      push("AI tagging finished with errors", "error");
      onTagged?.();
    } else if (status === "cancelled") {
      push("AI tagging was cancelled", "info");
    }
    setJobId(null);
  }, [jobId, status, push, onTagged]);

  const start = useCallback(
    async (ids: string[]) => {
      if (submitting || jobId || !ids.length) return;
      setSubmitting(true);
      try {
        // Heads-up if the model isn't ready yet (tagging will start when it is).
        try {
          const st = await fetch(`/api/ai/status`).then((r) =>
            r.ok ? r.json() : null,
          );
          if (st?.model_download?.status === "downloading") {
            push("Model is downloading… tagging will start when ready", "info");
          } else if (st?.model_load?.status === "loading") {
            push("Model is loading… tagging will start when ready", "info");
          }
        } catch {
          // ignore
        }
        const { job_id } = await postAiTag(ids);
        handled.current = null;
        setJobId(job_id);
        push("AI tagging queued", "success");
      } catch (e) {
        push(`Failed to start AI tagging: ${String(e)}`, "error");
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, jobId, push],
  );

  const [cancelling, setCancelling] = useState(false);
  const cancel = useCallback(async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      const { ok } = await postAiJobCancel(jobId);
      push(
        ok ? "Cancellation requested" : "Job already finished",
        ok ? "info" : "info",
      );
    } catch (e) {
      push(`Failed to cancel: ${String(e)}`, "error");
    } finally {
      setCancelling(false);
    }
  }, [jobId, cancelling, push]);

  return {
    start,
    cancel,
    submitting,
    cancelling,
    jobId,
    job: job ?? null,
    canCancel: !!jobId && isActiveJob(status),
  };
}
