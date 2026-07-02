import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSearch: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: mocks.useSearch,
}));

import { PreviewIndicator } from "./preview-indicator";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PreviewIndicator", () => {
  it("renders the preview name when a preview is active", () => {
    mocks.useSearch.mockReturnValue({ preview: "gio/apply-previews" });
    render(<PreviewIndicator />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("gio/apply-previews");
    // Passive: no button / exit affordance lives here.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing on live (no preview param)", () => {
    mocks.useSearch.mockReturnValue({ preview: undefined });
    const { container } = render(<PreviewIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it("treats a whitespace-only preview as live", () => {
    mocks.useSearch.mockReturnValue({ preview: "   " });
    const { container } = render(<PreviewIndicator />);
    expect(container).toBeEmptyDOMElement();
  });
});
