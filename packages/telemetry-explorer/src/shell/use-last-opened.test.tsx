import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { useLastOpened } from "./use-last-opened";

const render = (opened: string | undefined) =>
  renderHook(({ opened }) => useLastOpened(opened), { initialProps: { opened } });

describe("useLastOpened", () => {
  it("keeps an item opened from the list after it closes", () => {
    const { result, rerender } = render(undefined);
    rerender({ opened: "a" });
    rerender({ opened: undefined });
    expect(result.current).toBe("a");
  });

  it("ignores the item the page loaded on until it is opened from the list", () => {
    const { result, rerender } = render("a");
    rerender({ opened: undefined });
    expect(result.current).toBeUndefined();

    rerender({ opened: "a" });
    rerender({ opened: undefined });
    expect(result.current).toBe("a");
  });
});
