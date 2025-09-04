import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tag as TagIcon, Slash } from "lucide-react";

type TagAgg = { _id: string; count: number };

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function TagsPage() {
  const [tags, setTags] = useState<TagAgg[]>([]);
  const navigate = useNavigate();
  useEffect(() => {
    api<TagAgg[]>(`/api/tags`)
      .then(setTags)
      .catch(() => {});
  }, []);
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">Browse by Tag</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {/* Special tile: Untagged images */}
        <button
          className="rounded overflow-hidden bg-neutral-900 border border-neutral-800 p-4 text-left hover:bg-neutral-800"
          onClick={() => navigate(`/?no_tags=1`)}
          aria-label="Browse untagged images"
          title="Untagged"
        >
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="relative inline-flex items-center justify-center w-5 h-5">
              <TagIcon size={16} />
              <Slash
                size={16}
                className="absolute inset-0 text-purple-300 opacity-90"
              />
            </span>
            Untagged
          </div>
          <div className="text-xs text-neutral-400">Images with no tags</div>
        </button>
        {tags.map((t) => (
          <button
            key={t._id}
            className="rounded overflow-hidden bg-neutral-900 border border-neutral-800 p-4 text-left hover:bg-neutral-800"
            onClick={() => navigate(`/?tags=${encodeURIComponent(t._id)}`)}
          >
            <div className="text-lg font-semibold">{t._id}</div>
            <div className="text-xs text-neutral-400">{t.count} images</div>
          </button>
        ))}
      </div>
    </div>
  );
}
