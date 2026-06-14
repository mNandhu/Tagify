import { describe, it, expect } from "vitest";
import { tagBase, mergeTagSuggestions } from "./tagSuggest";

describe("tagBase", () => {
  it("strips manual/prompt prefixes, leaves AI tags bare", () => {
    expect(tagBase("manual:cat")).toBe("cat");
    expect(tagBase("prompt:cat")).toBe("cat");
    expect(tagBase("cat")).toBe("cat");
  });
});

describe("mergeTagSuggestions", () => {
  it("collapses same-text sources into one any: entry, summing counts", () => {
    expect(
      mergeTagSuggestions([
        { _id: "cat", count: 3 },
        { _id: "manual:cat", count: 1 },
        { _id: "prompt:dog", count: 2 },
      ]),
    ).toEqual([
      { _id: "any:cat", count: 4 },
      { _id: "any:dog", count: 2 },
    ]);
  });

  it("sorts merged entries by count descending", () => {
    expect(
      mergeTagSuggestions([
        { _id: "prompt:rare", count: 1 },
        { _id: "common", count: 10 },
      ]),
    ).toEqual([
      { _id: "any:common", count: 10 },
      { _id: "any:rare", count: 1 },
    ]);
  });

  it("ignores empty bases", () => {
    expect(mergeTagSuggestions([{ _id: "manual:", count: 5 }])).toEqual([]);
  });
});
