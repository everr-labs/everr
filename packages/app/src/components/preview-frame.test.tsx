// Exercises the ui `PreviewFrame` from the app suite: the ui package has no
// jsdom/testing-library, and the app is where the component is actually consumed.
import { PreviewFrame } from "@everr/ui/components/preview-frame";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const content = <div data-testid="content" />;

describe("PreviewFrame", () => {
  it("renders the message, actions, and framed content", () => {
    render(
      <PreviewFrame
        variant="info"
        message="Previewing X"
        actions={<button type="button">Exit</button>}
      >
        {content}
      </PreviewFrame>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Previewing X");
    expect(screen.getByRole("button", { name: "Exit" })).toBeInTheDocument();
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("keeps the frame border and the bar fill in sync from one variant", () => {
    const { rerender } = render(
      <PreviewFrame variant="info" message="hi">
        {content}
      </PreviewFrame>,
    );
    // The frame wraps the content; both the inset-ring edge and the bar fill are
    // the same tone.
    expect(screen.getByTestId("content").parentElement).toHaveClass(
      "ring-sky-500",
    );
    expect(screen.getByRole("status")).toHaveClass("bg-sky-500");

    // A single prop flips both the frame edge and the bar together.
    rerender(
      <PreviewFrame variant="warning" message="hi">
        {content}
      </PreviewFrame>,
    );
    expect(screen.getByTestId("content").parentElement).toHaveClass(
      "ring-amber-500",
    );
    expect(screen.getByRole("status")).toHaveClass("bg-amber-500");
  });

  it("shows a dismiss button only when onDismiss is given, and delegates to it", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <PreviewFrame variant="info" message="hi">
        {content}
      </PreviewFrame>,
    );
    // No dismiss affordance without an onDismiss handler.
    expect(
      screen.queryByRole("button", { name: /dismiss/i }),
    ).not.toBeInTheDocument();

    // Controlled: clicking dismiss just calls the handler; the parent decides.
    rerender(
      <PreviewFrame variant="info" message="hi" onDismiss={onDismiss}>
        {content}
      </PreviewFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Still visible — the component didn't dismiss itself.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("collapses the bar out of the a11y tree when dismissed, keeping the frame", () => {
    render(
      <PreviewFrame variant="info" message="hi" dismissed onDismiss={() => {}}>
        {content}
      </PreviewFrame>,
    );
    // Controlled `dismissed` removes the bar from the a11y tree; content stays.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });
});
