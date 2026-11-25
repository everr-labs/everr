import { render as renderElement, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { useFocusLastOpened, useLastOpened } from "./use-last-opened";

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

describe("useFocusLastOpened", () => {
  function List({ detailOpen }: { detailOpen: boolean }) {
    const ref = useFocusLastOpened<HTMLDivElement>(detailOpen);
    return (
      <div ref={ref}>
        <a href="#a">a</a>
        <div data-last-opened="">
          <a href="#b">b</a>
        </div>
      </div>
    );
  }

  it("gives focus back to the last opened row when the detail closes", () => {
    const { rerender } = renderElement(<List detailOpen />);
    expect(document.body).toHaveFocus();

    rerender(<List detailOpen={false} />);
    expect(screen.getByRole("link", { name: "b" })).toHaveFocus();
  });
});
