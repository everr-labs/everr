import { describe, expect, it, vi } from "vitest";
import { createTimeCursorStore } from "./shared-time-cursor";

describe("shared time cursor", () => {
  it("publishes one panel's timestamp to subscribers and clears only its owner", () => {
    const store = createTimeCursorStore();
    const first = Symbol("first panel");
    const second = Symbol("second panel");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(first, 100);
    expect(store.getSnapshot()?.timestamp).toBe(100);
    expect(listener).toHaveBeenCalledTimes(1);

    store.set(second, 200);
    store.clear(first);
    expect(store.getSnapshot()?.timestamp).toBe(200);
    expect(listener).toHaveBeenCalledTimes(2);

    store.clear(second);
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    store.set(first, 300);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
