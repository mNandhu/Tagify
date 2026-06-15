import { decode } from "blurhash";

/**
 * Derive a single accent color (CSS `rgb(...)`) from a BlurHash by decoding it
 * to one pixel. Returns null for a missing/invalid hash.
 */
export function accentFromBlurhash(hash?: string): string | null {
  if (!hash) return null;
  try {
    const [r, g, b] = decode(hash, 1, 1);
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
}
