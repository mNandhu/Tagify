import { describe, it, expect } from "vitest";
import {
  gridColumns,
  columnWidth,
  aspectHeight,
  estimateItemHeight,
  rowSpan,
} from "./masonryLayout";

describe("gridColumns", () => {
  it("maps width to Tailwind breakpoints", () => {
    expect(gridColumns(500)).toBe(2);
    expect(gridColumns(767)).toBe(2);
    expect(gridColumns(768)).toBe(3);
    expect(gridColumns(1023)).toBe(3);
    expect(gridColumns(1024)).toBe(4);
    expect(gridColumns(2000)).toBe(4);
  });
});

describe("columnWidth", () => {
  it("subtracts gaps between columns", () => {
    // 1000px, 4 cols, 12px gap => (1000 - 36) / 4 = 241
    expect(columnWidth(1000, 4, 12)).toBe(241);
  });
  it("returns full width for a single column", () => {
    expect(columnWidth(1000, 1, 12)).toBe(1000);
  });
  it("guards against zero/negative columns", () => {
    expect(columnWidth(1000, 0, 12)).toBe(1000);
  });
});

describe("aspectHeight", () => {
  it("preserves aspect ratio", () => {
    expect(aspectHeight({ width: 100, height: 200 }, 50)).toBe(100);
    expect(aspectHeight({ width: 200, height: 100 }, 50)).toBe(25);
  });
  it("falls back to square when dims are missing", () => {
    expect(aspectHeight({}, 80)).toBe(80);
  });
});

describe("estimateItemHeight", () => {
  it("floors at the minimum height", () => {
    expect(estimateItemHeight({ width: 1000, height: 10 }, 100)).toBe(150);
  });
  it("uses aspect height when above the minimum", () => {
    expect(estimateItemHeight({ width: 100, height: 300 }, 100)).toBe(300);
  });
});

describe("rowSpan", () => {
  it("computes spans covering the pixel height", () => {
    // (404 + 12) / (4 + 12) = 26
    expect(rowSpan(404, 4, 12)).toBe(26);
  });
  it("never drops below 1", () => {
    expect(rowSpan(0, 4, 12)).toBe(1);
    expect(rowSpan(-50, 4, 12)).toBe(1);
  });
  it("guards against a zero row unit", () => {
    expect(rowSpan(400, 0, 12)).toBe(1);
  });
});
