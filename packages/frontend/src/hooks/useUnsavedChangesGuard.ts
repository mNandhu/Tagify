import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

/**
 * Guards the two exits a page cannot intercept itself: closing the tab and
 * in-app navigation. The third exit — swapping what is being edited — belongs
 * to whoever owns the edit session, since only it knows what "switch" means.
 *
 * One `dirty` flag drives both, so the browser prompt and the router prompt can
 * never disagree about whether there is work to lose.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  message = "You have unsaved changes. Leave anyway?",
  confirmLeave: (m: string) => boolean = (m) => window.confirm(m),
) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Browsers show their own generic copy; preventDefault is what triggers it.
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (confirmLeave(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message, confirmLeave]);
}
