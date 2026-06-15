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
  Sparkles,
  Star,
  Copy,
  Ban,
  Download,
  PanelRight,
  Image as ImageIcon,
} from "lucide-react";
import { decode } from "blurhash";
import { resolveMediaUrl } from "../lib/media";

// Primary colour of an image, taken from its BlurHash DC term (the average
// colour) by decoding to a single pixel. Cheap, CORS-free, available before
// the full image loads. Returns an `rgb(...)` string or null when absent.
function accentFromBlurhash(hash?: string): string | null {
  if (!hash) return null;
  try {
    const [r, g, b] = decode(hash, 1, 1);
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
}
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

  const handleTouchMove = useCallback((_e: React.TouchEvent) => {
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
  const accent = accentFromBlurhash(data?.blurhash);

  return (
    <div
      className="h-dvh overflow-hidden bg-neutral-950 text-white flex relative"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
    >
      {/* Image stage */}
      <div className="flex-1 h-full flex items-center justify-center relative overflow-hidden">
        {/* Back icon (overlay) */}
        <button
          onClick={() => navigate(`/${filterQuery ? `?${filterQuery}` : ""}`)}
          className="absolute top-4 left-4 z-50 p-2 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 transition-transform transition-opacity duration-200 opacity-90 hover:opacity-100 hover:scale-[1.02]"
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft />
        </button>
        {/* Reopen details panel (overlay when collapsed) */}
        {!infoOpen && (
          <button
            onClick={() => setInfoOpen(true)}
            className="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/40 border border-white/10 hover:bg-black/60 transition-opacity duration-200 opacity-80 hover:opacity-100"
            title="Show details"
            aria-label="Show details"
          >
            <PanelRight />
          </button>
        )}
        {data ? (
          <div className="relative flex items-center justify-center">
            {/* Ambient glow — a blurred accent panel matching the image box.
                The blur spreads the primary colour outward from every edge, so
                the whole image acts as the light source (not a centre point).
                Blooms in only once the image has loaded. */}
            {accent && (
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 z-0 blur-[80px] transition-all duration-1000 ease-out ${
                  imgLoaded ? "opacity-60 scale-110" : "opacity-0 scale-90"
                }`}
                style={{ background: accent }}
              />
            )}
            <img
              src={fileUrl || `/api/images/${encodeURIComponent(data._id)}/file`}
              alt="image"
              onLoad={() => setImgLoaded(true)}
              className={`relative z-10 max-w-full max-h-dvh w-auto h-auto object-contain transition-opacity duration-300 ${
                imgLoaded ? "opacity-100" : "opacity-0"
              }`}
            />
          </div>
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
      {/* Details sidebar — docked on desktop, slide-over drawer on mobile */}
      <aside
        role="region"
        aria-label="Image details"
        className={`fixed lg:static inset-y-0 right-0 z-40 h-dvh lg:h-full w-full sm:w-[380px] lg:w-[400px] lg:shrink-0 flex flex-col border-l border-neutral-800 bg-neutral-900 lg:bg-neutral-900/95 backdrop-blur-sm shadow-xl shadow-black/30 transition-transform duration-300 ease-out lg:transition-none ${
          infoOpen ? "translate-x-0 lg:flex" : "translate-x-full lg:hidden"
        }`}
      >
        {data && (
          <>
            {/* Header: filename + quick actions */}
            <div className="flex items-start justify-between gap-2 p-3 border-b border-neutral-800 shrink-0">
              <div className="min-w-0">
                <div
                  className="text-sm font-semibold truncate"
                  title={data.path}
                >
                  {fileName}
                </div>
                <div className="text-xs text-neutral-400 mt-0.5">
                  {data.width}×{data.height} ·{" "}
                  {Math.round((data.size || 0) / 1024)} KB
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={
                    fileUrl ||
                    `/api/images/${encodeURIComponent(data._id)}/file`
                  }
                  download={fileName || ""}
                  className="p-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                  title="Download original"
                  aria-label="Download original"
                >
                  <Download size={16} />
                </a>
                <button
                  onClick={() => setInfoOpen(false)}
                  className="p-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                  title="Collapse panel"
                  aria-label="Collapse panel"
                >
                  <PanelRight size={16} />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
              {/* Tags */}
              <Section
                title="Tags"
                right={
                  <RatingEditor
                    id={data._id}
                    value={rating}
                    onDone={refreshImage}
                  />
                }
              >
                {aiTags.length ||
                manualTagsRaw.length ||
                promptTagsRaw.length ? (
                  <div className="flex flex-wrap gap-2">
                    {aiTags.map((t) => (
                      <TagChip
                        key={t}
                        label={t}
                        kind="ai"
                        onFilter={() => openTag(t)}
                        onThumb={() => void setTagThumbnail(t)}
                      />
                    ))}
                    {manualTagsRaw.map((t) => (
                      <TagChip
                        key={t}
                        label={formatTag(t)}
                        kind="manual"
                        onFilter={() => openTag(t)}
                        onThumb={() => void setTagThumbnail(t)}
                      />
                    ))}
                    {promptTagsRaw.map((t) => (
                      <TagChip
                        key={t}
                        label={formatTag(t)}
                        kind="prompt"
                        onFilter={() => openTag(t)}
                        onThumb={() => void setTagThumbnail(t)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-neutral-500">No tags yet.</div>
                )}
                <TagEditor id={data._id} onChange={refreshImage} />
              </Section>

              {/* Curation (Tagify-specific) */}
              <Section title="Curation">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-neutral-300">Score</span>
                  <ScoreStars value={score} onSet={applyScore} />
                </div>
                <button
                  onClick={() => void toggleQuarantine()}
                  className={`w-full px-3 py-2 rounded-lg border inline-flex items-center justify-center gap-2 text-sm transition-colors ${
                    quarantined
                      ? "bg-amber-900/40 border-amber-800 text-amber-100 hover:bg-amber-900/60"
                      : "bg-neutral-800 border-neutral-700 hover:bg-neutral-700"
                  }`}
                  title={quarantined ? "Restore (X)" : "Quarantine (X)"}
                >
                  <Ban size={14} /> {quarantined ? "Restore" : "Quarantine"}
                </button>
              </Section>

              {/* Generation data */}
              <GenPanel
                gen={data.gen}
                width={data.width}
                height={data.height}
                onCopyAll={() => void copyWorkflow()}
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function TagEditor({ id, onChange }: { id: string; onChange: () => void }) {
  const [val, setVal] = useState("");
  const [adding, setAdding] = useState(false);
  const { start, cancel, submitting, cancelling, jobId, job, canCancel } =
    useAiTagging(onChange);

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
      <div className="flex gap-2">
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
        {canCancel && (
          <button
            className="px-3 py-2 rounded bg-red-600/80 hover:bg-red-500 card-hover inline-flex items-center gap-2 disabled:opacity-50"
            onClick={() => void cancel()}
            disabled={cancelling}
            title="Cancel the in-progress AI tagging job"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

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

// Card shell used by the details sidebar — a titled, bordered panel with an
// optional right-aligned control (e.g. the rating editor).
function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const TAG_CHIP_STYLES: Record<
  "ai" | "manual" | "prompt",
  { cls: string; title: string }
> = {
  ai: { cls: "bg-neutral-800 border-neutral-700", title: "AI tag" },
  manual: {
    cls: "bg-emerald-900/30 border-emerald-800 text-emerald-100",
    title: "Manual tag",
  },
  prompt: {
    cls: "bg-sky-900/30 border-sky-800 text-sky-100",
    title: "Prompt-extracted tag",
  },
};

function TagChip({
  label,
  kind,
  onFilter,
  onThumb,
}: {
  label: string;
  kind: "ai" | "manual" | "prompt";
  onFilter: () => void;
  onThumb: () => void;
}) {
  const { cls, title } = TAG_CHIP_STYLES[kind];
  return (
    <span
      className={`group px-2 py-1 rounded-full text-xs border inline-flex items-center gap-1 ${cls}`}
      title={title}
    >
      <button
        type="button"
        className="hover:underline"
        title={`Filter by ${label}`}
        onClick={onFilter}
      >
        {label}
      </button>
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 transition-opacity hover:brightness-125"
        title="Set as tag thumbnail"
        aria-label={`Set thumbnail for ${label}`}
        onClick={onThumb}
      >
        <ImageIcon size={12} />
      </button>
    </span>
  );
}

// A small uppercase key/value pill for the "Other metadata" row.
function MetaChip({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value == null || value === "") return null;
  return (
    <span className="px-2 py-1 rounded bg-neutral-800/80 border border-neutral-700 text-[11px] inline-flex items-center gap-1">
      <span className="uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="text-neutral-100">{value}</span>
    </span>
  );
}

function ResourceRow({
  name,
  badge,
  sub,
}: {
  name: string;
  badge: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-sm text-sky-300 truncate" title={name}>
          {name}
        </div>
        {sub && <div className="text-xs text-neutral-500">{sub}</div>}
      </div>
      <span className="shrink-0 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-300">
        {badge}
      </span>
    </div>
  );
}

function CopyButton({
  text,
  label,
}: {
  text?: string | null;
  label: string;
}) {
  const { push } = useToast();
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          push(`${label} copied`, "success");
        } catch (e) {
          push(`Copy failed: ${String(e)}`, "error");
        }
      }}
      className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
      title={`Copy ${label.toLowerCase()}`}
      aria-label={`Copy ${label.toLowerCase()}`}
    >
      <Copy size={14} />
    </button>
  );
}

// Prompt / negative-prompt text with a collapse-by-default "Show more".
function PromptBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <p
        className={`text-sm text-neutral-300 whitespace-pre-wrap break-words ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
      {text.length > 140 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-sky-400 hover:text-sky-300"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function GenPanel({
  gen,
  width,
  height,
  onCopyAll,
}: {
  gen?: import("../lib/gen").GenMeta;
  width?: number;
  height?: number;
  onCopyAll: () => void;
}) {
  if (!gen || !gen.source) return null;
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Generation data</h2>
        <button
          type="button"
          onClick={onCopyAll}
          className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
          title="Copy all generation data"
        >
          <Copy size={12} /> Copy all
        </button>
      </div>

      {gen.model && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Resources used
          </div>
          <ResourceRow name={gen.model} badge="Checkpoint" />
        </div>
      )}

      {gen.prompt && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">Prompt</div>
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400">
                {gen.source}
              </span>
            </div>
            <CopyButton text={gen.prompt} label="Prompt" />
          </div>
          <PromptBlock text={gen.prompt} />
        </div>
      )}

      {gen.negative && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Negative prompt</div>
            <CopyButton text={gen.negative} label="Negative prompt" />
          </div>
          <PromptBlock text={gen.negative} />
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Other metadata
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MetaChip label="CFG" value={gen.cfg} />
          <MetaChip label="Steps" value={gen.steps} />
          <MetaChip label="Sampler" value={gen.sampler} />
          <MetaChip label="Seed" value={gen.seed} />
          <MetaChip label="Width" value={width} />
          <MetaChip label="Height" value={height} />
        </div>
      </div>
    </section>
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
