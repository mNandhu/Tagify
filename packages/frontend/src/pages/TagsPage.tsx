import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tag as TagIcon, Slash, Tags as TagsIcon } from "lucide-react";
import { resolveMediaUrl } from "../lib/media";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";

type TagAgg = { _id: string; count: number; thumb_image_id?: string | null };

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function TagsPage() {
  const [tags, setTags] = useState<TagAgg[] | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    api<TagAgg[]>(`/api/tags?include_manual=1`)
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  const formatTag = (raw: string) =>
    raw.startsWith("manual:") ? raw.slice("manual:".length) : raw;

  const isManual = (raw: string) => raw.startsWith("manual:");
  return (
    <div className="p-6">
      <PageHeader
        icon={TagsIcon}
        title="Browse by Tag"
        count={tags?.length}
        description="Jump into any tag, or surface what still needs tagging."
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {/* Special tile: Untagged images */}
        <button
          className="rounded-xl overflow-hidden bg-neutral-900/60 border border-neutral-800 p-4 text-left card-hover"
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
          className="rounded-xl overflow-hidden bg-neutral-900/60 border border-neutral-800 p-4 text-left card-hover"
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

        {tags === null
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl overflow-hidden bg-neutral-900/60 border border-neutral-800"
              >
                <Skeleton className="w-full pb-[56.25%] rounded-none" />
                <div className="p-3 space-y-2">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))
          : tags.map((t) => (
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
      className="rounded-xl overflow-hidden bg-neutral-900/60 border border-neutral-800 text-left card-hover"
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
        <div className="text-base font-semibold flex items-center gap-2">
          <span className="truncate">{formatTag(tag._id)}</span>
          {isManual(tag._id) ? (
            <Badge tone="success" className="text-[10px]">
              manual
            </Badge>
          ) : null}
        </div>
        <div className="text-xs text-neutral-400">{tag.count} images</div>
      </div>
    </button>
  );
}
