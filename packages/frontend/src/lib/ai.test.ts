import { describe, it, expect } from "vitest";
import {
  isTerminalJob,
  isActiveJob,
  isStatusBusy,
  type AIStatus,
} from "./ai";

describe("isTerminalJob", () => {
  it.each(["done", "error", "cancelled"])("is terminal: %s", (s) => {
    expect(isTerminalJob(s)).toBe(true);
  });
  it.each(["queued", "running", "cancelling", "unknown", undefined, null])(
    "is not terminal: %s",
    (s) => {
      expect(isTerminalJob(s)).toBe(false);
    },
  );
});

describe("isActiveJob", () => {
  it.each(["queued", "running", "cancelling"])("is active: %s", (s) => {
    expect(isActiveJob(s)).toBe(true);
  });
  it.each(["done", "error", "cancelled", undefined])(
    "is not active: %s",
    (s) => {
      expect(isActiveJob(s)).toBe(false);
    },
  );
});

describe("isStatusBusy", () => {
  const base: AIStatus = {
    model: { loaded: false },
    jobs: { recent: [], queue_depth: 0 },
    settings: {} as AIStatus["settings"],
  };

  it("is idle for null/empty status", () => {
    expect(isStatusBusy(null)).toBe(false);
    expect(isStatusBusy(base)).toBe(false);
  });

  it("is busy while the model is loading", () => {
    expect(isStatusBusy({ ...base, model_load: { status: "loading" } })).toBe(
      true,
    );
  });

  it("is busy while the model is downloading", () => {
    expect(
      isStatusBusy({ ...base, model_download: { status: "downloading" } }),
    ).toBe(true);
  });

  it("is busy while a recent job is active", () => {
    const job = {
      id: "j1",
      created_at: 0,
      status: "running",
      total: 1,
      done: 0,
      failed: 0,
    };
    expect(
      isStatusBusy({ ...base, jobs: { recent: [job], queue_depth: 0 } }),
    ).toBe(true);
  });

  it("is idle when recent jobs are all terminal", () => {
    const job = {
      id: "j1",
      created_at: 0,
      status: "done",
      total: 1,
      done: 1,
      failed: 0,
    };
    expect(
      isStatusBusy({ ...base, jobs: { recent: [job], queue_depth: 0 } }),
    ).toBe(false);
  });
});
