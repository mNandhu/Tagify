import { useCallback, useEffect, useRef } from "react";

// Slim scroll restoration for the gallery's custom overflow container.
// The fetch-until-itemCount dance the old util needed is gone: the Image feed
// query cache persists fetched pages across gallery -> ImageView -> gallery, so
// the rows are already mounted on return and we only need to restore scrollTop.

const PREFIX = "tagify_scroll_";
const MAX_AGE_MS = 10 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 200;
// Let async thumbnail layout (row spans) settle before restoring height.
const RESTORE_DELAY_MS = 100;

type Saved = { scrollTop: number; ts: number };

/**
 * Persist and restore the scroll position of `getContainer()` keyed by `key`
 * (derive it from the active Image filter). Restoration runs once `ready` is
 * true — i.e. the feed's items are mounted so scrollHeight is meaningful.
 */
export function useScrollRestoration(
  key: string,
  getContainer: () => HTMLElement | null,
  ready: boolean,
) {
  const storageKey = PREFIX + (key || "default");

  // Flush the current position immediately (e.g. just before navigating away,
  // where a pending debounced save would be cancelled by unmount).
  const save = useCallback(() => {
    const el = getContainer();
    if (!el) return;
    try {
      const saved: Saved = { scrollTop: el.scrollTop, ts: Date.now() };
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // ignore quota / private-mode errors
    }
  }, [storageKey, getContainer]);

  // Save on scroll (debounced).
  useEffect(() => {
    const el = getContainer();
    if (!el) return;
    let timer: number | undefined;
    const onScroll = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          const saved: Saved = { scrollTop: el.scrollTop, ts: Date.now() };
          sessionStorage.setItem(storageKey, JSON.stringify(saved));
        } catch {
          // ignore quota / private-mode errors
        }
      }, SAVE_DEBOUNCE_MS);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) window.clearTimeout(timer);
    };
  }, [storageKey, getContainer]);

  // Restore once, after items are ready.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || restoredFor.current === storageKey) return;
    const el = getContainer();
    if (!el) return;
    restoredFor.current = storageKey;

    let saved: Saved | null = null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      saved = raw ? (JSON.parse(raw) as Saved) : null;
    } catch {
      saved = null;
    }
    if (!saved || Date.now() - saved.ts > MAX_AGE_MS) return;

    const target = saved.scrollTop;
    const timer = window.setTimeout(() => {
      if (el.scrollHeight > target) el.scrollTo({ top: target, behavior: "auto" });
    }, RESTORE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, storageKey, getContainer]);

  return { save };
}
