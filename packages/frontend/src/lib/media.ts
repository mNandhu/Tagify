// Cache for media mode detection per session
let mediaMode: 'redirect' | 'url' | 'off' | null = null;
let mediaHost: string | null = null;

export async function resolveMediaUrl(endpoint: string): Promise<string> {
  try {
    // If we've already detected the mode, use it directly
    if (mediaMode === 'redirect' || mediaMode === 'off') {
      return endpoint;
    }
    
    if (mediaMode === 'url') {
      // Skip HEAD probe, go directly to JSON fetch
      const res = await fetch(endpoint, { method: "GET" });
      if (!res.ok) return endpoint;
      const data = (await res.json()) as { url?: string };
      if (data && typeof data.url === "string" && data.url) {
        // Cache media host for preconnect on first URL resolution
        if (!mediaHost && data.url.startsWith('http')) {
          try {
            const url = new URL(data.url);
            mediaHost = url.origin;
            addPreconnect(mediaHost);
          } catch {
            // Ignore URL parsing errors
          }
        }
        return data.url;
      }
      return endpoint;
    }

    // First time - probe to detect mode
    const head = await fetch(endpoint, { method: "HEAD" });
    if (!head.ok) return endpoint;
    
    const ct = head.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      // Redirect mode or direct stream => cache mode and return endpoint
      mediaMode = 'redirect'; // Could be 'off' too, but both behave the same for our purposes
      return endpoint;
    }
    
    // URL mode: fetch JSON to extract url and cache mode
    mediaMode = 'url';
    const res = await fetch(endpoint, { method: "GET" });
    if (!res.ok) return endpoint;
    const data = (await res.json()) as { url?: string };
    if (data && typeof data.url === "string" && data.url) {
      // Cache media host for preconnect on first URL resolution
      if (!mediaHost && data.url.startsWith('http')) {
        try {
          const url = new URL(data.url);
          mediaHost = url.origin;
          addPreconnect(mediaHost);
        } catch {
          // Ignore URL parsing errors
        }
      }
      return data.url;
    }
    return endpoint;
  } catch {
    return endpoint;
  }
}

// Add preconnect link to reduce connection latency
function addPreconnect(origin: string) {
  // Check if preconnect already exists
  if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
    return;
  }
  
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = origin;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}
