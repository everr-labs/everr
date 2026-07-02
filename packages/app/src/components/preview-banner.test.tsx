import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

import { PreviewBanner } from "./preview-banner";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PreviewBanner", () => {
  it("renders nothing on live (no preview)", () => {
    const { container } = render(<PreviewBanner preview={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a whitespace-only preview", () => {
    const { container } = render(<PreviewBanner preview="   " />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows generic overlay copy on lists (no status) with an exit action", () => {
    render(<PreviewBanner preview="gio/apply-previews" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      'Previewing "gio/apply-previews" — applied resources are overlaid on live.',
    );
    expect(
      screen.getByRole("button", { name: /exit preview/i }),
    ).toBeInTheDocument();
  });

  it("shows per-status copy on detail routes", () => {
    render(<PreviewBanner preview="gio/apply-previews" status="changed" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      'Changed in preview "gio/apply-previews" — this differs from live.',
    );
    expect(
      screen.getByRole("button", { name: /exit preview/i }),
    ).toBeInTheDocument();
  });

  it("clears the preview param on exit while preserving other params", async () => {
    render(<PreviewBanner preview="gio/apply-previews" status="added" />);
    await userEvent.click(
      screen.getByRole("button", { name: /exit preview/i }),
    );

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    const arg = mocks.navigate.mock.calls[0][0];
    expect(arg.to).toBe(".");
    // The search updater drops `preview` but leaves the rest of the URL intact.
    expect(
      arg.search({ preview: "gio/apply-previews", from: "now-1h" }),
    ).toEqual({
      preview: undefined,
      from: "now-1h",
    });
  });
});
