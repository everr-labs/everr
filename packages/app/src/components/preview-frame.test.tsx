// Exercises the ui `PreviewFrame` from the app suite: the ui package has no
// jsdom/testing-library, and the app is where the component is actually consumed.
import { PreviewFrame } from "@everr/ui/components/preview-frame";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("dismiss collapses the bar (out of the a11y tree) but keeps the frame", async () => {
    const onDismiss = vi.fn();
    render(
      <PreviewFrame
        variant="info"
        message="hi"
        dismissible
        onDismiss={onDismiss}
      >
        {content}
      </PreviewFrame>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // The framed content stays — dismissing the bar isn't leaving the frame.
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });
});
