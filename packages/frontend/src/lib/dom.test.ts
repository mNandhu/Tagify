import { describe, expect, it } from "vitest";
import { isFormField } from "./dom";

function el(tag: string): HTMLElement {
  return document.createElement(tag);
}

describe("isFormField", () => {
  it("is true for input/textarea/select", () => {
    expect(isFormField(el("input"))).toBe(true);
    expect(isFormField(el("textarea"))).toBe(true);
    expect(isFormField(el("select"))).toBe(true);
  });

  it("is true for a contentEditable element", () => {
    // jsdom doesn't reflect the contenteditable attribute onto the
    // isContentEditable property, so duck-type the target the handler sees.
    const target = { tagName: "DIV", isContentEditable: true } as HTMLElement;
    expect(isFormField(target)).toBe(true);
  });

  it("is false for a plain element and for null", () => {
    expect(isFormField(el("div"))).toBe(false);
    expect(isFormField(el("button"))).toBe(false);
    expect(isFormField(null)).toBe(false);
  });
});
