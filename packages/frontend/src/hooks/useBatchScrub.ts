import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { ImageDoc } from "../lib/imageFilter";

/** Wait this long before fetching — hovering past a tile shouldn't hit the API. */
const HOVER_INTENT_MS = 350;
/** How long each member is shown. */
const FRAME_MS = 650;
/** Members fetched per batch; enough to convey the batch, bounded per hover. */
const MAX_MEMBERS = 12;

/**
 * Cycles a batch tile through its members while the pointer rests on it.
 *
 * In the grouped view a batch of twenty variations collapses to one tile, and
 * the only way to see what else is in it is to drill in and come back. Since
 * batches are usually near-identical seeds of one prompt, a peek is enough to
 * decide whether the batch is worth opening — which is what this gives, without
 * a navigation.
 *
 * Deliberately hover-intent gated and fetched at most once per tile: the
 * grouped feed can show hundreds of batches, and a request per pointer-cross
 * would be worse than the problem it solves.
 */
export function useBatchScrub(groupId: string | undefined, active: boolean) {
  const [frames, setFrames] = useState<string[] | null>(null);
  const [frame, setFrame] = useState(0);
  // Marks that this tile's members have been *successfully* resolved, so a
  // second hover reuses them instead of refetching.
  //
  // It is deliberately not set before the request: doing that meant a hover
  // that ended while the fetch was in flight — i.e. any hover just past the
  // 350ms intent delay — left the flag set with no frames stored, and the guard
  // below then blocked every later hover. Batch peek stayed dead for that tile
  // for the rest of its mounted life.
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!active || !groupId || fetchedRef.current) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const docs = await api<ImageDoc[]>(
          `/api/images?group_id=${encodeURIComponent(groupId)}&limit=${MAX_MEMBERS}`,
        );
        if (cancelled) return;
        const urls = docs
          .map((d) => d.thumb_url ?? `/api/images/${encodeURIComponent(d._id)}/thumb`)
          .filter(Boolean);
        fetchedRef.current = true;
        setFrames(urls.length > 1 ? urls : null);
      } catch {
        // Peeking is a nicety — a failed fetch just leaves the still tile, and
        // leaves the flag clear so the next hover may try again.
        if (!cancelled) setFrames(null);
      }
    }, HOVER_INTENT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, groupId]);

  // Advance frames only while hovered; reset to the representative on leave so
  // the grid at rest always shows the same image it showed before.
  useEffect(() => {
    if (!active || !frames || frames.length < 2) {
      setFrame(0);
      return;
    }
    const id = setInterval(
      () => setFrame((f) => (f + 1) % frames.length),
      FRAME_MS,
    );
    return () => clearInterval(id);
  }, [active, frames]);

  const src = active && frames && frame > 0 ? frames[frame] : null;
  return { src, total: frames?.length ?? 0, position: frame };
}
