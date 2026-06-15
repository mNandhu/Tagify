/**
 * Strip the kind prefix (`manual:` / `prompt:`) from a stored tag for display.
 * Mirror of the backend's image_tags.base_of for the three tag kinds.
 */
export function formatTag(raw: string): string {
  if (raw.startsWith("manual:")) return raw.slice("manual:".length);
  if (raw.startsWith("prompt:")) return raw.slice("prompt:".length);
  return raw;
}
