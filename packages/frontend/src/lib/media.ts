export async function resolveMediaUrl(endpoint: string): Promise<string> {
  try {
    // Cheap content-type check without downloading bodies (works for url mode)
    const head = await fetch(endpoint, { method: "HEAD" });
    if (!head.ok) return endpoint;
    const ct = head.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      // Redirect mode or direct stream => let <img> fetch endpoint (browser will follow redirects)
      return endpoint;
    }
    // URL mode: fetch JSON to extract url
    const res = await fetch(endpoint, { method: "GET" });
    if (!res.ok) return endpoint;
    const data = (await res.json()) as { url?: string };
    if (data && typeof data.url === "string" && data.url) {
      return data.url;
    }
    return endpoint;
  } catch {
    return endpoint;
  }
}
