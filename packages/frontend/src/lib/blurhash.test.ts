import { describe, expect, it } from "vitest";
import { accentFromBlurhash } from "./blurhash";

describe("accentFromBlurhash", () => {
  it("returns null for a missing hash", () => {
    expect(accentFromBlurhash(undefined)).toBeNull();
    expect(accentFromBlurhash("")).toBeNull();
  });

  it("returns null for an invalid hash", () => {
    expect(accentFromBlurhash("not-a-hash")).toBeNull();
  });

  it("decodes a valid hash to an rgb() string", () => {
    const accent = accentFromBlurhash("LEHV6nWB2yk8pyo0adR*.7kCMdnj");
    expect(accent).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});
