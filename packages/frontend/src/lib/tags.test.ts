import { describe, expect, it } from "vitest";
import {
  formatSearchTag,
  formatTag,
  isAiTag,
  isManual,
  isPrompt,
  partitionTags,
} from "./tags";

describe("formatTag", () => {
  it("strips the manual: prefix", () => {
    expect(formatTag("manual:favourite")).toBe("favourite");
  });
  it("strips the prompt: prefix", () => {
    expect(formatTag("prompt:masterpiece")).toBe("masterpiece");
  });
  it("leaves a bare AI tag untouched", () => {
    expect(formatTag("1girl")).toBe("1girl");
  });
});

describe("tag kind predicates", () => {
  it("classifies the three kinds", () => {
    expect(isManual("manual:fav")).toBe(true);
    expect(isPrompt("prompt:masterpiece")).toBe(true);
    expect(isAiTag("1girl")).toBe(true);
    expect(isAiTag("manual:fav")).toBe(false);
    expect(isAiTag("prompt:x")).toBe(false);
  });
});

describe("partitionTags", () => {
  it("splits one array into the three kinds, preserving order", () => {
    const p = partitionTags([
      "1girl",
      "manual:fav",
      "prompt:masterpiece",
      "solo",
      "manual:keep",
    ]);
    expect(p.ai).toEqual(["1girl", "solo"]);
    expect(p.manual).toEqual(["manual:fav", "manual:keep"]);
    expect(p.prompt).toEqual(["prompt:masterpiece"]);
  });

  it("keeps an AI tag and its prompt twin as distinct kinds", () => {
    // The backend never dedupes these against each other.
    const p = partitionTags(["1girl", "prompt:1girl"]);
    expect(p.ai).toEqual(["1girl"]);
    expect(p.prompt).toEqual(["prompt:1girl"]);
  });

  it("handles an absent tag array", () => {
    expect(partitionTags()).toEqual({ ai: [], manual: [], prompt: [] });
  });
});

describe("formatSearchTag", () => {
  it("strips the merged any: prefix as well as the kind prefixes", () => {
    expect(formatSearchTag("any:cat")).toBe("cat");
    expect(formatSearchTag("manual:cat")).toBe("cat");
    expect(formatSearchTag("cat")).toBe("cat");
  });
});
