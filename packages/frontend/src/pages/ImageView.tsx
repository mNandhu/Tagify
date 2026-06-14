import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Info,
  X,
  Sparkles,
  Star,
  Copy,
  Ban,
  Image as ImageIcon,
} from "lucide-react";
import { resolveMediaUrl } from "../lib/media";
import { useToast } from "../components/Toasts";
import {
  parseFilters,
  serializeFilters,
  fetchImage,
  type ImageDoc,
} from "../lib/imageFilter";
import { useImageFeed } from "../hooks/useImageFeed";
import { useAiTagging } from "../hooks/useAiTagging";
import {
  setScore as apiSetScore,
  setQuarantine as apiSetQuarantine,
  fetchWorkflow,
  workflowClipboardText,
} from "../lib/gen";

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
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [infoOpen, setInfoOpen] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Image filter carried in the URL — drives the shared Image feed so the
  // pages the gallery already fetched are reused here (no separate paging code).
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const filterQuery = useMemo(
    () => serializeFilters(filters).toString(),
    [filters],
  );
  const toImage = useCallback(
    (imgId: string) =>
      `/image/${encodeURIComponent(imgId)}${filterQuery ? `?${filterQuery}` : ""}`,
    [filterQuery],
  );

  // Current image document (full doc with tags/rating); refetched after edits.
  const { data, refetch } = useQuery({
    queryKey: ["image", id],
    queryFn: ({ signal }) => fetchImage(id!, { signal }),
    enabled: !!id,
  });
  const refreshImage = useCallback(() => {
    void refetch();
  }, [refetch]);

  const score = data?.score ?? 0;
  const quarantined = !!data?.quarantined;

  const applyScore = useCallback(
    async (n: number) => {
      if (!id) return;
      try {
        await apiSetScore(id, n);
        refreshImage();
      } catch (e) {
        push(`Failed to set score: ${String(e)}`, "error");
      }
    },
    [id, push, refreshImage],
  );

  const toggleQuarantine = useCallback(async () => {
    if (!id) return;
    const next = !quarantined;
    try {
      await apiSetQuarantine(id, next);
      push(next ? "Quarantined" : "Restored", "info");
      refreshImage();
      // Remove this image from all gallery feed caches so the gallery doesn't
      // require a refresh to reflect the quarantine change.
      queryClient.setQueriesData<InfiniteData<ImageDoc[]>>(
        { queryKey: ["images"] },
        (old) =>
          old
            ? { ...old, pages: old.pages.map((pg) => pg.filter((x) => x._id !== id)) }
            : old,
      );
      queryClient.invalidateQueries({ queryKey: ["images"] });
      queryClient.invalidateQueries({ queryKey: ["image-groups"] });
    } catch (e) {
      push(`Failed to update quarantine: ${String(e)}`, "error");
    }
  }, [id, quarantined, push, refreshImage, queryClient]);

  const copyWorkflow = useCallback(async () => {
    if (!id) return;
    try {
      const wf = await fetchWorkflow(id);
      const text = workflowClipboardText(wf);
      if (!text) {
        push("No workflow data to copy", "info");
        return;
      }
      await navigator.clipboard.writeText(text);
      push("Workflow copied to clipboard", "success");
    } catch (e) {
      push(`Copy failed: ${String(e)}`, "error");
    }
  }, [id, push]);

  const feed = useImageFeed(filters);
  const list = feed.items;
  const index = useMemo(
    () => (id ? list.findIndex((x) => x._id === id) : -1),
    [id, list],
  );

  useEffect(() => {
    setImgLoaded(false);
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

  // If the current id isn't in the loaded feed pages yet, keep paging until
  // it appears or the feed is exhausted. fetchNextPage reads the shared cache.
  useEffect(() => {
    if (!id || index !== -1) return;
    if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
  }, [id, index, feed.hasNextPage, feed.isFetchingNextPage, feed.fetchNextPage]);

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

  const goPrev = useCallback(() => {
    if (index > 0) navigate(toImage(list[index - 1]._id));
  }, [index, list, navigate, toImage]);

  const goNext = useCallback(async () => {
    if (index < 0) return;
    if (index < list.length - 1) {
      navigate(toImage(list[index + 1]._id));
      return;
    }
    // At the end of the loaded pages: fetch the next one, then advance.
    if (feed.hasNextPage && !feed.isFetchingNextPage) {
      const res = await feed.fetchNextPage();
      const all = res.data?.pages.flat() ?? [];
      const nextItem = all[index + 1];
      if (nextItem) navigate(toImage(nextItem._id));
    }
  }, [index, list, navigate, toImage, feed.hasNextPage, feed.isFetchingNextPage, feed.fetchNextPage]);

  const hasMore = feed.hasNextPage;

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
        navigate(`/${filterQuery ? `?${filterQuery}` : ""}`);
      }
      // Curation: 1-5 set score, 0 clears, X quarantines/restores.
      if (e.key >= "0" && e.key <= "5") {
        e.preventDefault();
        void applyScore(Number(e.key));
      }
      if (e.key === "x" || e.key === "X" || e.key === "Delete") {
        e.preventDefault();
        void toggleQuarantine();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, navigate, filterQuery, applyScore, toggleQuarantine]);

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
    [goPrev, goNext],
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Optional: could add visual feedback here for swipe in progress
  }, []);

  const formatTag = useCallback((raw: string) => {
    if (raw.startsWith("manual:")) return raw.slice("manual:".length);
    if (raw.startsWith("prompt:")) return raw.slice("prompt:".length);
    return raw;
  }, []);

  const openTag = useCallback(
    (tagRaw: string) => {
      navigate(`/?tags=${encodeURIComponent(tagRaw)}`);
    },
    [navigate],
  );

  const setTagThumbnail = useCallback(
    async (tagRaw: string) => {
      if (!data?._id) return;
      try {
        const resp = await fetch(
          `/api/tags/thumbnail/${encodeURIComponent(tagRaw)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_id: data._id }),
          },
        );
        if (!resp.ok) throw new Error(await resp.text());
        push(`Set thumbnail for "${formatTag(tagRaw)}"`, "success");
      } catch (e) {
        push(`Failed to set thumbnail: ${String(e)}`, "error");
      }
    },
    [data?._id, formatTag, push],
  );

  if (!id) return null;

  const imageCol = "lg:col-span-12";
  const fileName = data?.path ? data.path.split(/[\\/]/).pop() : "";
  const aiTags = (data?.tags || []).filter(
    (t) => !t.startsWith("manual:") && !t.startsWith("prompt:"),
  );
  const manualTagsRaw = (data?.tags || []).filter((t) =>
    t.startsWith("manual:"),
  );
  const promptTagsRaw = (data?.tags || []).filter((t) =>
    t.startsWith("prompt:"),
  );
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
          onClick={() => navigate(`/${filterQuery ? `?${filterQuery}` : ""}`)}
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
        className={`fixed top-0 right-0 z-40 h-dvh w-full sm:w-[340px] md:w-[380px] lg:w-[420px] flex flex-col border-l border-neutral-800 p-4 bg-neutral-900/85 bg-gradient-to-b from-neutral-900/90 to-neutral-900/70 backdrop-blur-sm shadow-lg shadow-black/20 transition-transform duration-300 ease-out ${
          infoOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between mb-3 shrink-0">
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
          <div className="flex-1 min-h-0 overflow-y-auto -mr-4 pr-4 space-y-3">
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
              <RatingEditor id={data._id} value={rating} onDone={refreshImage} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Score</div>
              <ScoreStars value={score} onSet={applyScore} />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void copyWorkflow()}
                className="flex-1 px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 inline-flex items-center justify-center gap-2 text-sm"
                title="Copy generation workflow / parameters to clipboard"
              >
                <Copy size={14} /> Copy workflow
              </button>
              <button
                onClick={() => void toggleQuarantine()}
                className={`px-3 py-2 rounded border inline-flex items-center justify-center gap-2 text-sm ${
                  quarantined
                    ? "bg-amber-900/40 border-amber-800 text-amber-100 hover:bg-amber-900/60"
                    : "bg-neutral-800 border-neutral-700 hover:bg-neutral-700"
                }`}
                title={quarantined ? "Restore (X)" : "Quarantine (X)"}
              >
                <Ban size={14} /> {quarantined ? "Restore" : "Quarantine"}
              </button>
            </div>

            <GenPanel gen={data.gen} />

            <div>
              <div className="font-semibold mb-2">Tags</div>
              <div className="flex flex-wrap gap-2">
                {aiTags.map((t: string) => (
                  <span
                    key={t}
                    className="group px-2 py-1 rounded-full bg-neutral-800 text-xs border border-neutral-700 inline-flex items-center gap-1"
                  >
                    <button
                      type="button"
                      className="hover:underline"
                      title={`Filter by ${t}`}
                      onClick={() => openTag(t)}
                    >
                      {t}
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-neutral-300 hover:text-white"
                      title="Set as tag thumbnail"
                      aria-label={`Set thumbnail for ${t}`}
                      onClick={() => void setTagThumbnail(t)}
                    >
                      <ImageIcon size={12} />
                    </button>
                  </span>
                ))}
                {manualTagsRaw.map((t: string) => (
                  <span
                    key={t}
                    className="group px-2 py-1 rounded-full bg-emerald-900/30 text-xs border border-emerald-800 text-emerald-100 inline-flex items-center gap-1"
                    title="Manual tag"
                  >
                    <button
                      type="button"
                      className="hover:underline"
                      title={`Filter by ${formatTag(t)}`}
                      onClick={() => openTag(t)}
                    >
                      {formatTag(t)}
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-emerald-100/80 hover:text-emerald-100"
                      title="Set as tag thumbnail"
                      aria-label={`Set thumbnail for ${formatTag(t)}`}
                      onClick={() => void setTagThumbnail(t)}
                    >
                      <ImageIcon size={12} />
                    </button>
                  </span>
                ))}
                {promptTagsRaw.map((t: string) => (
                  <span
                    key={t}
                    className="group px-2 py-1 rounded-full bg-sky-900/30 text-xs border border-sky-800 text-sky-100 inline-flex items-center gap-1"
                    title="Prompt-extracted tag"
                  >
                    <button
                      type="button"
                      className="hover:underline"
                      title={`Filter by ${formatTag(t)}`}
                      onClick={() => openTag(t)}
                    >
                      {formatTag(t)}
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-sky-100/80 hover:text-sky-100"
                      title="Set as tag thumbnail"
                      aria-label={`Set thumbnail for ${formatTag(t)}`}
                      onClick={() => void setTagThumbnail(t)}
                    >
                      <ImageIcon size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <TagEditor id={data._id} onChange={refreshImage} />
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
  const { start, submitting, jobId, job } = useAiTagging(onChange);

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
  const ai = () => void start([id]);

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
        disabled={submitting || Boolean(jobId)}
        title={
          jobId
            ? "AI tagging already in progress"
            : "Run AI tagging for this image"
        }
      >
        <Sparkles size={16} />
        {submitting ? "Starting…" : jobId ? "AI Tagging…" : "AI Tagging"}
      </button>

      {job && (
        <div className="text-xs text-neutral-400">
          AI status: <span className="text-neutral-200">{job.status}</span>
          {job.total ? (
            <span>
              {" "}
              · {job.done + job.failed}/{job.total}
              {job.failed ? (
                <span className="text-red-300"> · {job.failed} failed</span>
              ) : null}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ScoreStars({
  value,
  onSet,
}: {
  value: number;
  onSet: (n: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5" title="Quality score (1-5, 0 to clear)">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`Set score ${n}`}
          onClick={() => onSet(n === value ? 0 : n)}
          className="p-0.5 text-amber-300 hover:scale-110 transition-transform"
        >
          <Star
            size={16}
            className={n <= value ? "fill-amber-300" : "fill-none opacity-40"}
          />
        </button>
      ))}
    </div>
  );
}

function GenField({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-neutral-400 shrink-0 w-16">{label}</span>
      <span className="text-neutral-100 break-words min-w-0">{value}</span>
    </div>
  );
}

function GenPanel({ gen }: { gen?: import("../lib/gen").GenMeta }) {
  if (!gen || !gen.source) return null;
  return (
    <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Generation</div>
        <span className="text-[10px] uppercase tracking-wide text-neutral-400 px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700">
          {gen.source}
        </span>
      </div>
      <GenField label="Prompt" value={gen.prompt} />
      <GenField label="Negative" value={gen.negative} />
      <GenField label="Model" value={gen.model} />
      <GenField label="Seed" value={gen.seed} />
      <GenField label="Sampler" value={gen.sampler} />
      <GenField label="Steps" value={gen.steps} />
      <GenField label="CFG" value={gen.cfg} />
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
          v,
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
