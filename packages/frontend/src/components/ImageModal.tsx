import React, { useEffect, useState } from "react";

export function ImageModal({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [newTag, setNewTag] = useState("");

  useEffect(() => {
    fetch(`/api/images/${id}`).then(async (r) => setData(await r.json()));
  }, [id]);

  const applyTags = async (tags: string[]) => {
    await fetch(`/api/tags/apply/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tags),
    });
    // refresh
    fetch(`/api/images/${id}`).then(async (r) => setData(await r.json()));
  };

  const removeTag = async (tag: string) => applyTags([tag]).then(() => {});

  const aiTag = async () => {
    await fetch(`/api/tags/ai/${id}`, { method: "POST" });
    fetch(`/api/images/${id}`).then(async (r) => setData(await r.json()));
  };

  if (!data) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded max-w-6xl w-full h-[80vh] grid grid-cols-3">
        <div className="col-span-2 p-4 flex items-center justify-center overflow-auto">
          {data.thumb_rel ? (
            <img
              src={`/api/thumbs/${data.thumb_rel}`}
              alt="preview"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="text-neutral-400">No preview</div>
          )}
        </div>
        <div className="border-l border-neutral-800 p-4 flex flex-col gap-3 overflow-auto">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-lg">Details</div>
            <button
              className="text-sm text-neutral-300 hover:text-white"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="text-xs text-neutral-400 break-all">{data.path}</div>
          <div className="text-sm">
            {data.width}×{data.height} · {Math.round((data.size || 0) / 1024)}{" "}
            KB
          </div>
          <div>
            <div className="font-semibold mb-2">Tags</div>
            <div className="flex flex-wrap gap-2 mb-2">
              {(data.tags || []).map((t: string) => (
                <span
                  key={t}
                  className="px-2 py-1 rounded bg-neutral-800 text-xs"
                >
                  {t}
                </span>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newTag.trim()) {
                  applyTags([newTag.trim()]);
                  setNewTag("");
                }
              }}
              className="flex gap-2"
            >
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Add tag"
                className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 flex-1"
              />
              <button className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500">
                Add
              </button>
            </form>
            <button
              className="mt-2 px-3 py-2 rounded bg-purple-600 hover:bg-purple-500"
              onClick={aiTag}
            >
              AI Tagging
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
