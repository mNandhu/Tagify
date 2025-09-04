import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
  Sparkles,
} from "lucide-react";
import { resolveMediaUrl } from "../lib/media";

type ImageDoc = {
  _id: string;
  path: string;
  thumb_rel?: string;
  width?: number;
  height?: number;
  size?: number;
  tags?: string[];
};

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

  const query = useMemo(() => {
    const allowed = ["tags", "logic", "library_id", "cursor", "limit"];
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
    const allowed = ["tags", "logic", "library_id", "cursor"];
    const sp = new URLSearchParams(searchParams);
    const out = new URLSearchParams();
    allowed.forEach((k) => sp.getAll(k).forEach((v) => out.append(k, v)));
    return out.toString();
  }, [searchParams]);

  useEffect(() => {
    if (!id) return;
    setImgLoaded(false);
    fetch(`/api/images/${id}`).then(async (r) => setData(await r.json()));
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

  useEffect(() => {
    const url = `/api/images${query ? `?${query}` : ""}`;
    fetch(url)
      .then(async (r) => r.json())
      .then((arr: ImageDoc[]) => setList(arr));
  }, [query]);

  useEffect(() => {
    if (!id || !list.length) return;
    setIndex(list.findIndex((x) => x._id === id));
  }, [id, list]);

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
    if (index > 0)
      navigate(`/image/${encodeURIComponent(list[index - 1]._id)}?${query}`);
  }, [index, list, navigate, query]);
  const goNext = useCallback(() => {
    if (index >= 0 && index < list.length - 1)
      navigate(`/image/${encodeURIComponent(list[index + 1]._id)}?${query}`);
  }, [index, list, navigate, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't trigger global shortcuts when typing in form fields
      const target = e.target as HTMLElement;
      const isFormField = target && (
        target.tagName.toLowerCase() === 'input' ||
        target.tagName.toLowerCase() === 'textarea' ||
        target.tagName.toLowerCase() === 'select' ||
        target.isContentEditable
      );
      
      if (isFormField) {
        return;
      }

      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "Escape")
        navigate(`/${returnQuery ? `?${returnQuery}` : ""}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, navigate]);

  if (!id) return null;

  const imageCol = "lg:col-span-12";
  const fileName = data?.path ? data.path.split(/[\\/]/).pop() : "";

  return (
    <div className="min-h-dvh bg-neutral-950 text-white grid grid-cols-12 relative">
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
            disabled={index < 0 || index >= list.length - 1}
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
            <div>
              <div className="font-semibold mb-2">Tags</div>
              <div className="flex flex-wrap gap-2">
                {(data.tags || []).map((t: string) => (
                  <span
                    key={t}
                    className="px-2 py-1 rounded-full bg-neutral-800 text-xs border border-neutral-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <TagEditor
                id={data._id}
                onChange={async () => {
                  const r = await fetch(`/api/images/${data._id}`);
                  setData(await r.json());
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
  const add = async () => {
    const tags = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!tags.length) return;
    await fetch(`/api/tags/apply/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tags),
    });
    setVal("");
    onChange();
  };
  const ai = async () => {
    await fetch(`/api/tags/ai/${id}`, { method: "POST" });
    onChange();
  };
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Add tags (comma separated)"
          className="px-2 py-2 rounded bg-neutral-900 border border-neutral-800 flex-1"
        />
        <button
          className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 card-hover"
          onClick={add}
        >
          Add
        </button>
      </div>
      <button
        className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-500 card-hover inline-flex items-center gap-2"
        onClick={ai}
      >
        <Sparkles size={16} />
        AI Tagging
      </button>
    </div>
  );
}
