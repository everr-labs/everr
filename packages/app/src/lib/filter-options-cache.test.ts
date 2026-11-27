import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clearFilterOptionsCache, createFilterOptionsCache } from "./filter-options-cache";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

function signedIn(userId: string, organizationId: string) {
  const cache = createFilterOptionsCache(userId, organizationId);
  if (!cache) throw new Error("expected a cache for an active organization");
  return cache;
}

const key = ["explore", "union-service-options"];

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  clearFilterOptionsCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("filter options cache", () => {
  it("returns what the same user and organization stored", () => {
    signedIn("user-1", "org-a").write(key, ["api", "web"]);

    expect(signedIn("user-1", "org-a").read(key)).toEqual(["api", "web"]);
  });

  it("survives a reload", async () => {
    signedIn("user-1", "org-a").write(key, ["api"]);

    vi.resetModules();
    const reloaded = await import("./filter-options-cache");
    const { createFilterOptionsCache: create } = reloaded;

    expect(create("user-1", "org-a")?.read(key)).toEqual(["api"]);
  });

  it("reads nothing another organization or user stored", () => {
    signedIn("user-1", "org-a").write(key, ["api"]);

    expect(signedIn("user-1", "org-b").read(key)).toBeUndefined();
    expect(signedIn("user-2", "org-a").read(key)).toBeUndefined();
  });

  it("has no cache without an active organization", () => {
    expect(createFilterOptionsCache("user-1", null)).toBeUndefined();
  });

  it("clears every stored list and leaves other storage alone", () => {
    signedIn("user-1", "org-a").write(key, ["api"]);
    signedIn("user-2", "org-b").write(key, ["web"]);
    storage.setItem("theme", "dark");

    clearFilterOptionsCache();

    expect(signedIn("user-1", "org-a").read(key)).toBeUndefined();
    expect(signedIn("user-2", "org-b").read(key)).toBeUndefined();
    expect(storage.getItem("theme")).toBe("dark");
    expect(storage.length).toBe(1);
  });

  it("ignores a list older than a week", () => {
    vi.useFakeTimers();
    const cache = signedIn("user-1", "org-a");
    cache.write(key, ["api"]);

    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 - 1);
    expect(cache.read(key)).toEqual(["api"]);

    vi.advanceTimersByTime(2);
    expect(cache.read(key)).toBeUndefined();
  });

  it("keeps the 100 most recent lists", () => {
    vi.useFakeTimers();
    const cache = signedIn("user-1", "org-a");
    for (let i = 0; i < 101; i++) {
      cache.write(["list", String(i)], [i]);
      vi.advanceTimersByTime(1);
    }

    expect(cache.read(["list", "0"])).toBeUndefined();
    expect(cache.read(["list", "1"])).toEqual([1]);
    expect(cache.read(["list", "100"])).toEqual([100]);
  });

  it("starts empty when the stored value is corrupt", () => {
    storage.setItem("everr.filter-options.v1:user-1:org-a", "{not json");
    const cache = signedIn("user-1", "org-a");

    expect(cache.read(key)).toBeUndefined();
    cache.write(key, ["api"]);
    expect(cache.read(key)).toEqual(["api"]);
  });

  it("does not break when storage throws", () => {
    const fail = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", {
      localStorage: { length: 1, key: fail, getItem: fail, setItem: fail, removeItem: fail },
    });
    const cache = signedIn("user-1", "org-a");

    expect(() => cache.write(key, ["api"])).not.toThrow();
    expect(() => cache.read(key)).not.toThrow();
    expect(() => clearFilterOptionsCache()).not.toThrow();
  });

  it("does nothing without a window", () => {
    vi.unstubAllGlobals();
    const cache = signedIn("user-1", "org-a");

    expect(() => cache.write(key, ["api"])).not.toThrow();
    expect(cache.read(key)).toBeUndefined();
    expect(() => clearFilterOptionsCache()).not.toThrow();
  });
});
