import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScrollArea, ScrollAreaScroller } from "./scroll-area";

// jsdom lays nothing out, so every element measures 0x0 and Base UI reads the
// scroll area as having nothing to scroll. Scrollbars only mount for an axis
// that overflows, so the size has to be faked for them to appear at all.
const sizeKeys = [
  "clientHeight",
  "clientWidth",
  "scrollHeight",
  "scrollWidth",
] as const;

function overflowBothAxes() {
  for (const key of sizeKeys) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get() {
        return key.startsWith("scroll") ? 500 : 100;
      },
    });
  }
}

afterEach(() => {
  for (const key of sizeKeys) {
    delete (HTMLElement.prototype as Partial<HTMLElement>)[key];
  }
});

describe("ScrollArea", () => {
  it("renders its children inside the viewport", () => {
    render(
      <ScrollArea className="h-20">
        <p>span attributes</p>
      </ScrollArea>,
    );
    const child = screen.getByText("span attributes");
    expect(child.closest("[data-slot='scroll-area-viewport']")).not.toBeNull();
  });

  it("forwards the viewport ref to the scrolling element", () => {
    let viewport: HTMLDivElement | null = null;
    render(
      <ScrollArea
        viewportRef={(node) => {
          viewport = node;
        }}
      >
        <p>content</p>
      </ScrollArea>,
    );
    expect(viewport).not.toBeNull();
    expect(viewport).toHaveAttribute("data-slot", "scroll-area-viewport");
  });

  it("forwards viewportProps to the viewport element", () => {
    render(
      <ScrollArea viewportProps={{ "data-scroll-to-top": "" }}>
        <p>content</p>
      </ScrollArea>,
    );
    const viewport = screen
      .getByText("content")
      .closest("[data-slot='scroll-area-viewport']");
    expect(viewport).toHaveAttribute("data-scroll-to-top", "");
  });

  it("renders only the vertical scrollbar by default", async () => {
    overflowBothAxes();
    const { container } = render(
      <ScrollArea>
        <p>content</p>
      </ScrollArea>,
    );
    await waitFor(() => {
      const bars = container.querySelectorAll(
        "[data-slot='scroll-area-scrollbar']",
      );
      expect(bars).toHaveLength(1);
      expect(bars[0]).toHaveAttribute("data-orientation", "vertical");
    });
  });

  it("clips the axis it does not scroll", () => {
    const { container } = render(
      <>
        <ScrollArea>
          <p>vertical</p>
        </ScrollArea>
        <ScrollArea orientation="horizontal">
          <p>horizontal</p>
        </ScrollArea>
        <ScrollArea orientation="both">
          <p>both</p>
        </ScrollArea>
      </>,
    );
    const [v, h, b] = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-slot='scroll-area-viewport']",
      ),
    );
    expect(v?.style.overflowX).toBe("hidden");
    expect(v?.style.overflowY).toBe("");
    expect(h?.style.overflowY).toBe("hidden");
    expect(h?.style.overflowX).toBe("");
    expect(b?.style.overflowX).toBe("");
    expect(b?.style.overflowY).toBe("");
  });

  it("keeps the landmark of a semantic render element", () => {
    render(
      <ScrollArea render={<main />}>
        <p>content</p>
      </ScrollArea>,
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders both scrollbars when orientation is both", async () => {
    overflowBothAxes();
    const { container } = render(
      <ScrollArea orientation="both">
        <p>content</p>
      </ScrollArea>,
    );
    await waitFor(() =>
      expect(
        container.querySelectorAll("[data-slot='scroll-area-scrollbar']"),
      ).toHaveLength(2),
    );
  });

  it("renders no scrollbar for an axis with nothing to scroll", async () => {
    const { container } = render(
      <ScrollArea orientation="both">
        <p>content</p>
      </ScrollArea>,
    );
    await waitFor(() =>
      expect(
        container.querySelectorAll("[data-slot='scroll-area-scrollbar']"),
      ).toHaveLength(0),
    );
  });
});

describe("ScrollAreaScroller", () => {
  it("puts the ref and the virtuoso attributes on the scrolling viewport", () => {
    let scroller: HTMLDivElement | null = null;
    render(
      <ScrollAreaScroller
        ref={(node) => {
          scroller = node;
        }}
        data-virtuoso-scroller
        tabIndex={0}
        style={{ position: "relative", overflowY: "auto" }}
      >
        <p>rows</p>
      </ScrollAreaScroller>,
    );
    expect(scroller).toHaveAttribute("data-slot", "scroll-area-viewport");
    expect(scroller).toHaveAttribute("data-virtuoso-scroller");
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveStyle({ position: "relative" });
  });

  it("leaves the overflow of the viewport to the scroll area", () => {
    const { container } = render(
      <ScrollAreaScroller style={{ overflowY: "auto" }}>
        <p>rows</p>
      </ScrollAreaScroller>,
    );
    const viewport = container.querySelector<HTMLDivElement>(
      "[data-slot='scroll-area-viewport']",
    );
    expect(viewport?.style.overflowY).toBe("");
  });

  it("sizes the root, not the viewport, from className", () => {
    const { container } = render(
      <ScrollAreaScroller className="h-full">
        <p>rows</p>
      </ScrollAreaScroller>,
    );
    expect(container.querySelector("[data-slot='scroll-area']")).toHaveClass(
      "h-full",
    );
    expect(
      container.querySelector("[data-slot='scroll-area-viewport']"),
    ).not.toHaveClass("h-full");
  });
});
