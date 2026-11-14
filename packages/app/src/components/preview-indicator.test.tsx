import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  useSearch: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: mocks.useSearch,
  useNavigate: () => mocks.navigate,
}));

import { PreviewIndicator } from "./preview-indicator";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PreviewIndicator", () => {
  it.each([undefined, "   "])("renders nothing on live (preview %j)", (preview) => {
    mocks.useSearch.mockReturnValue({ preview });
    const { container } = render(<PreviewIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it("exits preview mode by clearing the preview param, preserving others", () => {
    mocks.useSearch.mockReturnValue({ preview: "gio/apply-previews" });
    render(<PreviewIndicator />);

    fireEvent.click(screen.getByRole("button", { name: /exit preview/i }));

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    const arg = mocks.navigate.mock.calls[0][0];
    expect(arg.to).toBe(".");
    expect(arg.search({ preview: "gio/apply-previews", tab: "logs" })).toEqual({
      tab: "logs",
      preview: undefined,
    });
  });
});
