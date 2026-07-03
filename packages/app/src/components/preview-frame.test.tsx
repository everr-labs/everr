// Tested from the app suite: the ui package has no jsdom/testing-library.
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
    expect(screen.getByTestId("content").parentElement).toHaveClass(
      "ring-sky-500",
    );
    expect(screen.getByRole("status")).toHaveClass("bg-sky-500");

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
    expect(
      screen.queryByRole("button", { name: /dismiss/i }),
    ).not.toBeInTheDocument();

    rerender(
      <PreviewFrame variant="info" message="hi" onDismiss={onDismiss}>
        {content}
      </PreviewFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Controlled: it didn't dismiss itself.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("collapses the bar out of the a11y tree when dismissed, keeping the frame", () => {
    render(
      <PreviewFrame variant="info" message="hi" dismissed onDismiss={() => {}}>
        {content}
      </PreviewFrame>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });
});
