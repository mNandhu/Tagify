/**
 * Whether an event target is a text-entry control, so global keyboard shortcuts
 * can bow out while the user is typing. Was copy-pasted in three keydown
 * handlers (ImageView + two in AllImagesPage); this is the one copy.
 */
export function isFormField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable === true
  );
}
