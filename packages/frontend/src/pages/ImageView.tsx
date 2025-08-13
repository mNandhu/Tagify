import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

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
  const [infoOpen, setInfoOpen] = useState(true);
  const [list, setList] = useState<ImageDoc[]>([]);
  const [index, setIndex] = useState<number>(-1);
  const query = useMemo(() => {
    const allowed = ["tags", "logic", "library_id", "offset", "limit"]; // passed from grid
    const sp = new URLSearchParams(searchParams);
    const out = new URLSearchParams();
    allowed.forEach((k) => {
      const vals = sp.getAll(k);
      vals.forEach((v) => out.append(k, v));
    });
    return out.toString();
  }, [searchParams]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/images/${id}`).then(async (r) => setData(await r.json()));
  }, [id]);

  // fetch current list for navigation (using same filters)
  useEffect(() => {
    const url = `/api/images${query ? `?${query}` : ""}`;
    fetch(url)
      .then(async (r) => r.json())
      .then((arr: ImageDoc[]) => {
        setList(arr);
      });
  }, [query]);

  // compute index of current id
  useEffect(() => {
    if (!id || !list.length) return;
    const i = list.findIndex((x) => x._id === id);
    setIndex(i);
  }, [id, list]);

  const goPrev = useCallback(() => {
    if (index > 0)
      navigate(`/image/${encodeURIComponent(list[index - 1]._id)}?${query}`);
  }, [index, list, navigate, query]);
  const goNext = useCallback(() => {
    if (index >= 0 && index < list.length - 1)
      navigate(`/image/${encodeURIComponent(list[index + 1]._id)}?${query}`);
  }, [index, list, navigate, query]);

  // keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "Escape") navigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, navigate]);

  if (!id) return null;

  return (
    <div className="min-h-dvh bg-neutral-950 text-white grid grid-cols-12">
      <button
        onClick={() => navigate(-1)}
        className="fixed top-4 left-4 z-50 px-3 py-2 rounded bg-black/50 border border-white/10 hover:bg-black/60"
        aria-label="Back"
      >
        ← Back
      </button>
      <div className="col-span-12 lg:col-span-9 flex items-center justify-center p-6">
        {data ? (
          <img
            src={`/api/images/${encodeURIComponent(data._id)}/file`}
            alt="image"
            className="max-w-full max-h-[90vh] object-contain"
          />
        ) : (
          <div className="text-neutral-400">Loading…</div>
        )}
      </div>
      <div className="col-span-12 lg:col-span-3 border-l border-neutral-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Info</div>
          <button
            className="text-sm text-neutral-300 hover:text-white"
            onClick={() => setInfoOpen((v) => !v)}
            aria-expanded={infoOpen}
          >
            {infoOpen ? "Hide" : "Show"}
          </button>
        </div>
        {infoOpen && data && (
          <div className="space-y-3">
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
                    className="px-2 py-1 rounded bg-neutral-800 text-xs"
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
          className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 flex-1"
        />
        <button
          className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500"
          onClick={add}
        >
          Add
        </button>
      </div>
      <button
        className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-500"
        onClick={ai}
      >
        AI Tagging
      </button>
    </div>
  );
}
