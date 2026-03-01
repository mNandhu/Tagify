import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tag as TagIcon, Slash } from "lucide-react";
import { resolveMediaUrl } from "../lib/media";

type TagAgg = { _id: string; count: number; thumb_image_id?: string | null };

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function TagsPage() {
  const [tags, setTags] = useState<TagAgg[]>([]);
  const navigate = useNavigate();
  useEffect(() => {
    api<TagAgg[]>(`/api/tags?include_manual=1`)
      .then(setTags)
      .catch(() => {});
  }, []);

  const formatTag = (raw: string) =>
    raw.startsWith("manual:") ? raw.slice("manual:".length) : raw;

  const isManual = (raw: string) => raw.startsWith("manual:");
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

        {/* Special tile: Untagged by AI */}
        <button
          className="rounded overflow-hidden bg-neutral-900 border border-neutral-800 p-4 text-left hover:bg-neutral-800"
          onClick={() => navigate(`/?no_ai_tags=1`)}
          aria-label="Browse images missing AI tags"
          title="AI Untagged"
        >
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="relative inline-flex items-center justify-center w-5 h-5">
              <TagIcon size={16} />
              <Slash
                size={16}
                className="absolute inset-0 text-emerald-300 opacity-90"
              />
            </span>
            AI Untagged
          </div>
          <div className="text-xs text-neutral-400">
            Images missing AI-generated tags
          </div>
        </button>

        {tags.map((t) => (
          <TagCard
            key={t._id}
            tag={t}
            onClick={() => navigate(`/?tags=${encodeURIComponent(t._id)}`)}
            formatTag={formatTag}
            isManual={isManual}
          />
        ))}
      </div>
    </div>
  );
}

function TagCard({
  tag,
  onClick,
  formatTag,
  isManual,
}: {
  tag: TagAgg;
  onClick: () => void;
  formatTag: (raw: string) => string;
  isManual: (raw: string) => boolean;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const id = tag.thumb_image_id;
    if (!id) {
      setThumbUrl(null);
      return;
    }
    const endpoint = `/api/images/${encodeURIComponent(id)}/thumb`;
    resolveMediaUrl(endpoint)
      .then((url) => {
        if (alive) setThumbUrl(url);
      })
      .catch(() => {
        if (alive) setThumbUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [tag.thumb_image_id]);

  return (
    <button
      className="rounded overflow-hidden bg-neutral-900 border border-neutral-800 text-left hover:bg-neutral-800"
      onClick={onClick}
    >
      <div className="relative w-full pb-[56.25%] bg-neutral-800">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={formatTag(tag._id)}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-500">
            <TagIcon size={28} />
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-lg font-semibold flex items-center gap-2">
          {formatTag(tag._id)}
          {isManual(tag._id) ? (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-900/30 border border-emerald-800 text-emerald-100"
              title="Manual tag"
            >
              manual
            </span>
          ) : null}
        </div>
        <div className="text-xs text-neutral-400">{tag.count} images</div>
      </div>
    </button>
  );
}
