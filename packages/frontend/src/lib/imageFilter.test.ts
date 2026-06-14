import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTERS,
  parseFilters,
  serializeFilters,
  buildImagesQuery,
  nextCursorOf,
  type Filters,
  type ImageDoc,
} from "./imageFilter";

const roundTrip = (f: Filters): Filters =>
  parseFilters(serializeFilters(f));

describe("Image filter URL round-trip", () => {
  it("preserves the default (empty) filter", () => {
    expect(roundTrip(DEFAULT_FILTERS)).toEqual(DEFAULT_FILTERS);
  });

  it("preserves a fully-populated filter", () => {
    const f: Filters = {
      tags: ["1girl", "solo"],
      logic: "or",
      libraryId: "lib123",
      noTags: false,
      noAiTags: true,
      quarantined: true,
      promptTerms: ["cyberpunk", "neon"],
      promptLogic: "or",
      model: "sdxl",
      minW: 512,
      maxW: 2048,
      minH: 768,
      maxH: undefined,
    };
    expect(roundTrip(f)).toEqual(f);
  });

  it("preserves tag order", () => {
    const f: Filters = { ...DEFAULT_FILTERS, tags: ["b", "a", "c"] };
    expect(roundTrip(f).tags).toEqual(["b", "a", "c"]);
  });
});

describe("parseFilters", () => {
  it("defaults logic to 'and' for missing/invalid values", () => {
    expect(parseFilters(new URLSearchParams()).logic).toBe("and");
    expect(parseFilters(new URLSearchParams("logic=bogus")).logic).toBe("and");
  });

  it("reads the no_tags / no_ai_tags toggles", () => {
    const f = parseFilters(new URLSearchParams("no_tags=1&no_ai_tags=1"));
    expect(f.noTags).toBe(true);
    expect(f.noAiTags).toBe(true);
  });

  it("migrates the legacy singular `tag` param", () => {
    const f = parseFilters(new URLSearchParams("tag=cat&tag=dog"));
    expect(f.tags).toEqual(["cat", "dog"]);
    // re-serializing emits the modern `tags` param
    expect(serializeFilters(f).getAll("tags")).toEqual(["cat", "dog"]);
    expect(serializeFilters(f).getAll("tag")).toEqual([]);
  });

  it("prefers `tags` over legacy `tag` when both present", () => {
    const f = parseFilters(new URLSearchParams("tags=new&tag=old"));
    expect(f.tags).toEqual(["new"]);
  });
});

describe("serializeFilters", () => {
  it("omits falsy/default values", () => {
    const sp = serializeFilters(DEFAULT_FILTERS);
    expect(sp.has("library_id")).toBe(false);
    expect(sp.has("no_tags")).toBe(false);
    expect(sp.has("no_ai_tags")).toBe(false);
  });

  it("never includes pagination params", () => {
    const sp = serializeFilters({ ...DEFAULT_FILTERS, tags: ["x"] });
    expect(sp.has("cursor")).toBe(false);
    expect(sp.has("limit")).toBe(false);
  });
});

describe("buildImagesQuery", () => {
  it("adds the default limit and no cursor", () => {
    const qs = new URLSearchParams(buildImagesQuery(DEFAULT_FILTERS));
    expect(qs.get("limit")).toBe("100");
    expect(qs.has("cursor")).toBe(false);
  });

  it("adds an explicit cursor and limit", () => {
    const qs = new URLSearchParams(
      buildImagesQuery(DEFAULT_FILTERS, { cursor: "abc", limit: 50 }),
    );
    expect(qs.get("cursor")).toBe("abc");
    expect(qs.get("limit")).toBe("50");
  });
});

describe("nextCursorOf", () => {
  const doc = (id: string): ImageDoc => ({ _id: id, path: `${id}.png` });

  it("returns the last id of a page", () => {
    expect(nextCursorOf([doc("a"), doc("b"), doc("c")])).toBe("c");
  });

  it("returns null for an empty page", () => {
    expect(nextCursorOf([])).toBeNull();
  });
});
