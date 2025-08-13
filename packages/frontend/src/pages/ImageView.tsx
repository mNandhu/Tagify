import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

export default function ImageView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [infoOpen, setInfoOpen] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/images/${id}`).then(async (r) => setData(await r.json()));
  }, [id]);

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
        {data?.thumb_rel ? (
          <img
            src={`/api/thumbs/${data.thumb_rel}`}
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
            aria-expanded={infoOpen ? true : false}
          >
            {infoOpen ? "Hide" : "Show"}
          </button>
        </div>
        {infoOpen && (
          <div className="space-y-3">
            <div className="text-xs text-neutral-400 break-all">
              {data?.path}
            </div>
            <div className="text-sm">
              {data?.width}×{data?.height} ·{" "}
              {Math.round((data?.size || 0) / 1024)} KB
            </div>
            <div>
              <div className="font-semibold mb-2">Tags</div>
              <div className="flex flex-wrap gap-2">
                {(data?.tags || []).map((t: string) => (
                  <span
                    key={t}
                    className="px-2 py-1 rounded bg-neutral-800 text-xs"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
