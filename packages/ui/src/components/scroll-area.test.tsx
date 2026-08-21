import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollArea } from "./scroll-area";

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

  it("renders only the vertical scrollbar by default", () => {
    const { container } = render(
      <ScrollArea>
        <p>content</p>
      </ScrollArea>,
    );
    const bars = container.querySelectorAll(
      "[data-slot='scroll-area-scrollbar']",
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute("data-orientation", "vertical");
  });

  it("renders both scrollbars when orientation is both", () => {
    const { container } = render(
      <ScrollArea orientation="both">
        <p>content</p>
      </ScrollArea>,
    );
    expect(
      container.querySelectorAll("[data-slot='scroll-area-scrollbar']"),
    ).toHaveLength(2);
  });
});
