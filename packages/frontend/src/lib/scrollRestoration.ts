/**
 * Scroll restoration utility for preserving gallery scroll position
 * when navigating to/from ImageView
 */

export interface ScrollState {
  scrollTop: number;
  timestamp: number;
  cursor?: string;
  itemCount: number;
}

const STORAGE_KEY_PREFIX = 'tagify_scroll_';
const MAX_AGE_MS = 1000 * 60 * 10; // 10 minutes

/**
 * Generate a storage key based on current filters
 */
function generateStorageKey(searchParams: URLSearchParams): string {
  // Only include filter-related params, exclude cursor for consistent key
  const filterParams = new URLSearchParams();
  const allowedKeys = ['tags', 'logic', 'library_id', 'no_tags'];
  
  allowedKeys.forEach(key => {
    const values = searchParams.getAll(key);
    values.forEach(value => filterParams.append(key, value));
  });
  
  // Sort params for consistent key generation
  const sortedParams = Array.from(filterParams.entries()).sort();
  const paramString = new URLSearchParams(sortedParams).toString();
  
  return STORAGE_KEY_PREFIX + (paramString || 'default');
}

/**
 * Save current scroll state to sessionStorage
 */
export function saveScrollState(
  scrollTop: number,
  searchParams: URLSearchParams,
  cursor?: string,
  itemCount: number = 0
): void {
  try {
    const key = generateStorageKey(searchParams);
    const state: ScrollState = {
      scrollTop,
      timestamp: Date.now(),
      cursor,
      itemCount,
    };
    
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    // Ignore storage errors (e.g., quota exceeded, incognito mode)
    console.warn('Failed to save scroll state:', error);
  }
}

/**
 * Restore scroll state from sessionStorage
 */
export function restoreScrollState(searchParams: URLSearchParams): ScrollState | null {
  try {
    const key = generateStorageKey(searchParams);
    const stored = sessionStorage.getItem(key);
    
    if (!stored) return null;
    
    const state: ScrollState = JSON.parse(stored);
    
    // Check if state is too old
    if (Date.now() - state.timestamp > MAX_AGE_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    
    return state;
  } catch (error) {
    console.warn('Failed to restore scroll state:', error);
    return null;
  }
}

/**
 * Clear scroll state for current filters
 */
export function clearScrollState(searchParams: URLSearchParams): void {
  try {
    const key = generateStorageKey(searchParams);
    sessionStorage.removeItem(key);
  } catch (error) {
    console.warn('Failed to clear scroll state:', error);
  }
}

/**
 * Clear all old scroll states (cleanup utility)
 */
export function clearOldScrollStates(): void {
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        try {
          const stored = sessionStorage.getItem(key);
          if (stored) {
            const state: ScrollState = JSON.parse(stored);
            if (now - state.timestamp > MAX_AGE_MS) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // Remove corrupted entries
          keysToRemove.push(key);
        }
      }
    }
    
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
  } catch (error) {
    console.warn('Failed to clear old scroll states:', error);
  }
}

/**
 * Debounced scroll position saver
 */
export function createDebouncedScrollSaver(
  delay: number = 100
): (scrollTop: number, searchParams: URLSearchParams, cursor?: string, itemCount?: number) => void {
  let timeoutId: number | undefined;
  
  return (scrollTop: number, searchParams: URLSearchParams, cursor?: string, itemCount: number = 0) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = window.setTimeout(() => {
      saveScrollState(scrollTop, searchParams, cursor, itemCount);
    }, delay);
  };
}