import { describe, expect, it } from "vitest";
import { formatTag } from "./tags";

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
