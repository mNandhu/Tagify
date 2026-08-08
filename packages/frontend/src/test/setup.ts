import "@testing-library/jest-dom/vitest";

// This jsdom environment runs on an opaque origin, which leaves `localStorage`
// undefined rather than merely empty. Anything reading a persisted preference
// (useFilters' grouped-view memory, useDensity's zoom) therefore can't be
// exercised at all without a stand-in. An in-memory implementation, reset
// between files by the fresh module registry, keeps those paths testable.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

// jsdom implements neither observer. Both are pure layout-measurement APIs that
// never fire in a zero-size jsdom layout anyway, so inert stand-ins are the
// honest stand-in: components that observe get to mount, and nothing pretends
// to report a size. Defined here rather than stubbed per-test because the
// gallery, the skeleton and the thumbnail loader all need them.
class InertObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

for (const name of ["ResizeObserver", "IntersectionObserver"] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === "undefined") {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: InertObserver,
    });
  }
}

// jsdom has no scroll implementation, so these are missing entirely rather than
// being no-ops. The gallery calls both when keyboard focus moves a tile into
// view; without stand-ins, any test that arrows through the grid dies on a
// TypeError inside an effect rather than on its own assertion.
for (const name of ["scrollIntoView", "scrollTo", "scrollBy"] as const) {
  if (typeof (Element.prototype as unknown as Record<string, unknown>)[name] !== "function") {
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      writable: true,
      value: () => {},
    });
  }
}
