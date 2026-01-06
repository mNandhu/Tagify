import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Info,
  X,
  Sparkles,
} from "lucide-react";
import { resolveMediaUrl } from "../lib/media";
import { useToast } from "../components/Toasts";

type ImageDoc = {
  _id: string;
  path: string;
  thumb_rel?: string;
  width?: number;
  height?: number;
  size?: number;
  tags?: string[];
  rating?: string;
  ai?: {
    rating?: Record<string, number>;
  };
};

function pickRating(doc: ImageDoc | null | undefined): string {
  const r = (doc?.rating || "").trim();
  if (r) return r;
  const m = doc?.ai?.rating;
  if (m && typeof m === "object") {
    let bestKey: string | null = null;
    let bestVal = -Infinity;
    for (const [k, v] of Object.entries(m)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n > bestVal) {
        bestVal = n;
        bestKey = k;
      }
    }
    if (bestKey) return bestKey;
  }
  return "-";
}

function ratingBadgeClass(rating: string): string {
  switch (rating) {
    case "general":
    case "safe":
      return "bg-emerald-900/30 border-emerald-800 text-emerald-100";
    case "sensitive":
      return "bg-amber-900/30 border-amber-800 text-amber-100";
    case "questionable":
      return "bg-orange-900/30 border-orange-800 text-orange-100";
    case "explicit":
      return "bg-red-900/30 border-red-800 text-red-100";
    default:
      return "bg-neutral-800 border-neutral-700 text-neutral-100";
  }
}

export default function ImageView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<ImageDoc | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [list, setList] = useState<ImageDoc[]>([]);
  const [index, setIndex] = useState<number>(-1);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // Derived page size from URL (defaults to 100 if unspecified/invalid)
  const pageLimit = useMemo(() => {
    const limStr = new URLSearchParams(searchParams).get("limit");
    const n = limStr ? Number(limStr) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 100;
  }, [searchParams]);

  // Build base query for list loading (exclude cursor on purpose so ImageView can page seamlessly)
  const baseQuery = useMemo(() => {
    const allowed = [
      "tags",
      "logic",
      "library_id",
      "limit",
      "no_tags",
      "no_ai_tags",
    ]; // exclude 'cursor'
    const sp = new URLSearchParams(searchParams);
    const out = new URLSearchParams();
    allowed.forEach((k) => {
      const vals = sp.getAll(k);
      vals.forEach((v) => out.append(k, v));
    });
    return out.toString();
  }, [searchParams]);

  // Build return URL to gallery with filters preserved
  const returnQuery = useMemo(() => {
    const allowed = [
      "tags",
      "logic",
      "library_id",
      "cursor",
      "no_tags",
      "no_ai_tags",
    ];
    const sp = new URLSearchParams(searchParams);
    const out = new URLSearchParams();
    allowed.forEach((k) => sp.getAll(k).forEach((v) => out.append(k, v)));
    return out.toString();
  }, [searchParams]);

  useEffect(() => {
    if (!id) return;
    setImgLoaded(false);
    const controller = new AbortController();
    fetch(`/api/images/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as ImageDoc;
      })
      .then((doc) => setData(doc))
      .catch((e) => {
        if (e?.name === "AbortError") return;
        console.error(e);
      });
    return () => controller.abort();
  }, [id]);

  // Resolve the actual file URL (supports pre-signed URL mode)
  useEffect(() => {
    if (!id) return;
    const ep = `/api/images/${encodeURIComponent(id)}/file`;
    setFileUrl(ep);
    resolveMediaUrl(ep)
      .then((u) => setFileUrl(u))
      .catch(() => setFileUrl(ep));
  }, [id]);

  // Initial load (no cursor) and whenever filters change
  useEffect(() => {
    const url = `/api/images${baseQuery ? `?${baseQuery}` : ""}`;
    const controller = new AbortController();
    loadingMoreRef.current = true;
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as ImageDoc[];
      })
      .then((arr: ImageDoc[]) => {
        setList(arr);
        setHasMore(arr.length >= pageLimit);
        setNextCursor(arr.length ? arr[arr.length - 1]._id : null);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        console.error(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingMoreRef.current = false;
      });

    return () => controller.abort();
  }, [baseQuery, pageLimit]);

  useEffect(() => {
    if (!id || !list.length) return;
    setIndex(list.findIndex((x) => x._id === id));
  }, [id, list]);

  // If current id is not yet in list, and there are more pages, keep fetching until found or exhausted
  useEffect(() => {
    if (!id) return;
    if (index !== -1) return; // already found
    if (!hasMore || loadingMoreRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    const loadUntilFound = async () => {
      loadingMoreRef.current = true;
      try {
        // Safety cap to avoid endless loops
        const maxExtraPages = 50;
        let pages = 0;
        while (!cancelled && pages < maxExtraPages) {
          if (!nextCursor) break;
          const q = new URLSearchParams(baseQuery);
          q.set("cursor", nextCursor);
          const url = `/api/images?${q.toString()}`;
          const resp = await fetch(url, { signal: controller.signal });
          if (!resp.ok) throw new Error(await resp.text());
          const arr: ImageDoc[] = await resp.json();
          if (cancelled) return;
          if (!arr.length) {
            setHasMore(false);
            setNextCursor(null);
            break;
          }
          setList((prev) => [...prev, ...arr]);
          setHasMore(arr.length >= pageLimit);
          setNextCursor(arr.length ? arr[arr.length - 1]._id : null);
          pages += 1;
          // After appending, see if we've included the target id
          const found = arr.find((x) => x._id === id);
          if (found) break;
          if (arr.length < pageLimit) break; // no more data
        }
      } finally {
        // Always reset loadingMoreRef so subsequent effect runs can proceed,
        // even if this fetch was aborted (e.g., when deps change).
        loadingMoreRef.current = false;
      }
    };
    loadUntilFound();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, index, hasMore, nextCursor, baseQuery, pageLimit]);

  // Preload previous/next images for snappier navigation (works with redirect & url modes)
  useEffect(() => {
    if (!list.length || index < 0) return;
    const preload = (idx: number) => {
      const it = list[idx];
      if (!it) return;
      const img = new Image();
      const ep = `/api/images/${encodeURIComponent(it._id)}/file`;
      resolveMediaUrl(ep)
        .then((u) => (img.src = u))
        .catch(() => (img.src = ep));
    };
    preload(index - 1);
    preload(index + 1);
  }, [index, list]);

  const buildQueryForNav = useCallback(() => {
    // Preserve filters when navigating but continue to exclude cursor so next page loads smoothly
    return baseQuery;
  }, [baseQuery]);

  const goPrev = useCallback(() => {
    if (index > 0) {
      navigate(
        `/image/${encodeURIComponent(list[index - 1]._id)}${
          buildQueryForNav() ? `?${buildQueryForNav()}` : ""
        }`
      );
    }
  }, [index, list, navigate, buildQueryForNav]);

  const goNext = useCallback(async () => {
    if (index >= 0 && index < list.length - 1) {
      navigate(
        `/image/${encodeURIComponent(list[index + 1]._id)}${
          buildQueryForNav() ? `?${buildQueryForNav()}` : ""
        }`
      );
      return;
    }
    // At the end of current list: try to load more and then move forward
    if (index >= list.length - 1 && hasMore && !loadingMoreRef.current) {
      loadingMoreRef.current = true;
      try {
        if (!nextCursor) return;
        const q = new URLSearchParams(baseQuery);
        q.set("cursor", nextCursor);
        const url = `/api/images?${q.toString()}`;
        const resp = await fetch(url);
        const arr: ImageDoc[] = await resp.json();
        setList((prev) => [...prev, ...arr]);
        setHasMore(arr.length >= pageLimit);
        setNextCursor(arr.length ? arr[arr.length - 1]._id : null);
        if (arr.length) {
          navigate(
            `/image/${encodeURIComponent(arr[0]._id)}${
              buildQueryForNav() ? `?${buildQueryForNav()}` : ""
            }`
          );
        }
      } finally {
        loadingMoreRef.current = false;
      }
    }
  }, [
    index,
    list,
    navigate,
    hasMore,
    nextCursor,
    baseQuery,
    pageLimit,
    buildQueryForNav,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't trigger global shortcuts when typing in form fields
      const target = e.target as HTMLElement;
      const isFormField =
        target &&
        (target.tagName.toLowerCase() === "input" ||
          target.tagName.toLowerCase() === "textarea" ||
          target.tagName.toLowerCase() === "select" ||
          target.isContentEditable);

      if (isFormField) {
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        navigate(`/${returnQuery ? `?${returnQuery}` : ""}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, navigate, returnQuery]);

  // Touch/swipe navigation
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || e.changedTouches.length !== 1) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      // Minimum swipe distance (pixels)
      const minSwipeDistance = 50;
      // Maximum vertical movement to still count as horizontal swipe
      const maxVerticalDistance = 100;

      // Check if this is a horizontal swipe
      if (
        Math.abs(deltaX) >= minSwipeDistance &&
        Math.abs(deltaY) <= maxVerticalDistance
      ) {
        e.preventDefault();
        if (deltaX > 0) {
          // Swipe right -> go to previous image
          goPrev();
        } else {
          // Swipe left -> go to next image
          goNext();
        }
      }

      touchStartRef.current = null;
    },
    [goPrev, goNext]
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Optional: could add visual feedback here for swipe in progress
  }, []);

  if (!id) return null;

  const imageCol = "lg:col-span-12";
  const fileName = data?.path ? data.path.split(/[\\/]/).pop() : "";
  const aiTags = (data?.tags || []).filter((t) => !t.startsWith("manual:"));
  const manualTags = (data?.tags || [])
    .filter((t) => t.startsWith("manual:"))
    .map((t) => t.slice("manual:".length));
  const rating = pickRating(data);

  return (
    <div
      className="min-h-dvh bg-neutral-950 text-white grid grid-cols-12 relative"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
    >
      <div
        className={`col-span-12 ${imageCol} flex items-center justify-center p-6 relative`}
      >
        {/* Back icon (overlay) */}
        <button
          onClick={() => navigate(`/${returnQuery ? `?${returnQuery}` : ""}`)}
          className="absolute top-4 left-4 z-50 p-2 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 transition-transform transition-opacity duration-200 opacity-90 hover:opacity-100 hover:scale-[1.02]"
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft />
        </button>
        {/* Info toggle icon (overlay when closed) */}
        {!infoOpen && (
          <button
            onClick={() => setInfoOpen(true)}
            className="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 transition-opacity duration-200 opacity-80 hover:opacity-100"
            title="Show Info"
          >
            <Info />
          </button>
        )}
        {data ? (
          <img
            src={fileUrl || `/api/images/${encodeURIComponent(data._id)}/file`}
            alt="image"
            onLoad={() => setImgLoaded(true)}
            className={`max-w-full max-h-[90vh] object-contain transition-opacity duration-300 ${
              imgLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : (
          <div className="text-neutral-400">Loading…</div>
        )}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2">
          <button
            disabled={index <= 0}
            onClick={goPrev}
            className="pointer-events-auto p-2 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 disabled:opacity-40 disabled:hover:bg-black/40 transition-opacity duration-200 opacity-80 hover:opacity-100"
            aria-label="Previous"
            title="Previous"
          >
            <ChevronLeft />
          </button>
          <button
            disabled={index < 0 || (index >= list.length - 1 && !hasMore)}
            onClick={goNext}
            className="pointer-events-auto p-2 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 disabled:opacity-40 disabled:hover:bg-black/40 transition-opacity duration-200 opacity-80 hover:opacity-100"
            aria-label="Next"
            title="Next"
          >
            <ChevronRight />
          </button>
        </div>
      </div>
      <div
        role="region"
        aria-label="Image information"
        className={`fixed top-0 right-0 z-40 h-dvh w-full sm:w-[340px] md:w-[380px] lg:w-[420px] border-l border-neutral-800 p-4 bg-neutral-900/85 bg-gradient-to-b from-neutral-900/90 to-neutral-900/70 backdrop-blur-sm shadow-lg shadow-black/20 transition-transform duration-300 ease-out ${
          infoOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Info</div>
          <button
            className="text-sm text-neutral-300 hover:text-white"
            onClick={() => setInfoOpen(false)}
            title="Close Info"
            aria-label="Close Info"
          >
            <X size={16} />
          </button>
        </div>
        {infoOpen && data && (
          <div className="space-y-3">
            <div className="text-sm font-semibold truncate" title={data.path}>
              {fileName}
            </div>
            <div className="text-xs text-neutral-400 break-all">
              {data.path}
            </div>
            <div className="text-sm">
              {data.width}×{data.height} · {Math.round((data.size || 0) / 1024)}{" "}
              KB
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Rating</div>
              <RatingEditor
                id={data._id}
                value={rating}
                onDone={async () => {
                  try {
                    const r = await fetch(
                      `/api/images/${encodeURIComponent(data._id)}`
                    );
                    if (!r.ok) throw new Error(await r.text());
                    setData(await r.json());
                  } catch (e) {
                    console.error(e);
                  }
                }}
              />
            </div>

            <div>
              <div className="font-semibold mb-2">Tags</div>
              <div className="flex flex-wrap gap-2">
                {aiTags.map((t: string) => (
                  <span
                    key={t}
                    className="px-2 py-1 rounded-full bg-neutral-800 text-xs border border-neutral-700"
                  >
                    {t}
                  </span>
                ))}
                {manualTags.map((t: string) => (
                  <span
                    key={`manual:${t}`}
                    className="px-2 py-1 rounded-full bg-emerald-900/30 text-xs border border-emerald-800 text-emerald-100"
                    title="Manual tag"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <TagEditor
                id={data._id}
                onChange={async () => {
                  try {
                    const r = await fetch(
                      `/api/images/${encodeURIComponent(data._id)}`
                    );
                    if (!r.ok) throw new Error(await r.text());
                    setData(await r.json());
                  } catch (e) {
                    console.error(e);
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TagEditor({ id, onChange }: { id: string; onChange: () => void }) {
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const { push } = useToast();
  const [aiSubmitting, setAiSubmitting] = useState(false);
  const [aiJobId, setAiJobId] = useState<string | null>(null);
  const [aiJobStatus, setAiJobStatus] = useState<{
    status: string;
    total: number;
    done: number;
    failed: number;
    current?: string | null;
  } | null>(null);
  const add = async () => {
    if (adding) return;
    const tags = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!tags.length) return;
    setAdding(true);
    await fetch(`/api/tags/apply/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tags),
    });
    setVal("");
    onChange();
    setAdding(false);
  };
  const ai = async () => {
    if (aiSubmitting) return;
    setAiSubmitting(true);
    try {
      // If model is loading/downloading, give the user a heads-up.
      try {
        const st = await fetch(`/api/ai/status`).then((r) =>
          r.ok ? r.json() : null
        );
        const loadState = st?.model_load?.status;
        const dlState = st?.model_download?.status;
        if (dlState === "downloading") {
          push("Model is downloading… tagging will start when ready", "info");
        } else if (loadState === "loading") {
          push("Model is loading… tagging will start when ready", "info");
        }
      } catch {
        // ignore
      }

      const resp = await fetch(`/api/ai/tag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const r = (await resp.json()) as { job_id: string };
      setAiJobId(r.job_id);
      setAiJobStatus({ status: "queued", total: 1, done: 0, failed: 0 });
      push("AI tagging queued", "success");
    } catch (e) {
      push(`Failed to start AI tagging: ${String(e)}`, "error");
    } finally {
      setAiSubmitting(false);
    }
  };

  // Poll job status so user sees progress/errors.
  useEffect(() => {
    if (!aiJobId) return;
    let alive = true;
    let timer: number | null = null;
    let delayMs = 1000;
    let lastStatus: string | null = null;

    const schedule = (ms: number) => {
      if (!alive) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(tick, ms);
    };

    const tick = async () => {
      try {
        const resp = await fetch(`/api/ai/jobs/${encodeURIComponent(aiJobId)}`);
        if (!resp.ok) return;
        const j = (await resp.json()) as {
          status?: string;
          total?: number;
          done?: number;
          failed?: number;
          current?: string | null;
        };
        if (!alive) return;
        const statusStr = String(j.status || "unknown");
        const total = Number(j.total || 0);
        const done = Number(j.done || 0);
        const failed = Number(j.failed || 0);
        setAiJobStatus({
          status: statusStr,
          total,
          done,
          failed,
          current: j.current,
        });

        // Adaptive polling: back off when status is stable.
        if (lastStatus === statusStr) {
          delayMs = Math.min(5000, delayMs + 500);
        } else {
          delayMs = 1000;
          lastStatus = statusStr;
        }

        if (statusStr === "done") {
          push("AI tagging completed", "success");
          setAiJobId(null);
          // Refresh tags immediately.
          onChange();
          return;
        } else if (statusStr === "error") {
          push("AI tagging finished with errors", "error");
          setAiJobId(null);
          onChange();
          return;
        } else if (statusStr === "cancelled") {
          push("AI tagging was cancelled", "info");
          setAiJobId(null);
          return;
        }
      } catch {
        // ignore transient errors
      }

      schedule(delayMs);
    };

    tick();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [aiJobId, onChange, push]);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Add manual tags (comma separated)"
          className="px-2 py-2 rounded bg-neutral-900 border border-neutral-800 flex-1"
        />
        <button
          className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 card-hover"
          onClick={add}
          disabled={adding}
        >
          Add
        </button>
      </div>
      <button
        className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-500 card-hover inline-flex items-center gap-2 disabled:opacity-50"
        onClick={ai}
        disabled={aiSubmitting || Boolean(aiJobId)}
        title={
          aiJobId
            ? "AI tagging already in progress"
            : "Run AI tagging for this image"
        }
      >
        <Sparkles size={16} />
        {aiSubmitting ? "Starting…" : aiJobId ? "AI Tagging…" : "AI Tagging"}
      </button>

      {aiJobStatus && (
        <div className="text-xs text-neutral-400">
          AI status:{" "}
          <span className="text-neutral-200">{aiJobStatus.status}</span>
          {aiJobStatus.total ? (
            <span>
              {" "}
              · {aiJobStatus.done + aiJobStatus.failed}/{aiJobStatus.total}
              {aiJobStatus.failed ? (
                <span className="text-red-300">
                  {" "}
                  · {aiJobStatus.failed} failed
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function RatingEditor({
  id,
  value,
  onDone,
}: {
  id: string;
  value: string;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const v = (value || "-").trim() || "-";

  const setRating = async (next: string) => {
    if (next === v) return;
    setSaving(true);
    try {
      const resp = await fetch(`/api/images/${encodeURIComponent(id)}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: next }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      push("Rating updated", "success");
      onDone();
    } catch (e) {
      push(`Failed to update rating: ${String(e)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative inline-block group">
      <div
        className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1.5 transition-all duration-200 ${ratingBadgeClass(
          v
        )} ${
          saving
            ? "opacity-50"
            : "group-hover:scale-[1.02] group-hover:brightness-110"
        }`}
      >
        <span className="font-medium">{v}</span>
        <ChevronDown size={12} className="opacity-70" />
      </div>
      <select
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
        value={v}
        disabled={saving}
        onChange={(e) => void setRating(e.target.value)}
        title="Change rating"
      >
        <option value="-">-</option>
        <option value="general">general</option>
        <option value="sensitive">sensitive</option>
        <option value="questionable">questionable</option>
        <option value="explicit">explicit</option>
      </select>
    </div>
  );
}
