import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api", () => {
  it("parses JSON on a 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })),
    );
    await expect(api<{ ok: number }>("/x")).resolves.toEqual({ ok: 1 });
  });

  it("throws the response body text on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(api("/x")).rejects.toThrow("boom");
  });

  it("forwards the init (method/body) to fetch", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await api("/x", { method: "POST", body: "{}" });
    expect(spy).toHaveBeenCalledWith("/x", { method: "POST", body: "{}" });
  });
});
