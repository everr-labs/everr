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

  it("floats the pill via a centered, zero-height, sticky lane so content scrolls under it", () => {
    render(<PreviewBanner preview="gio/apply-previews" />);
    // The pill sits in a sticky, centered lane that reserves no height (`h-0`)
    // and swallows its own flex gap (margins summing to -12px: `-mt-2` + `-mb-1`,
    // with `-mt-2` pulling the resting position to the same 4px offset `top-1`
    // pins at), so it floats over the content rather than pushing it down;
    // `items-start` keeps the h-0 lane from stretch-squashing the pill;
    // `pointer-events-none` lets clicks reach the content beneath. It centers
    // within the padded column, not the viewport — so no edge-to-edge negative
    // margins.
    const wrapper = screen.getByRole("status").parentElement;
    expect(wrapper).toHaveClass(
      "sticky",
      "top-1",
      "flex",
      "items-start",
      "justify-center",
      "h-0",
      "-mt-2",
      "-mb-1",
      "pointer-events-none",
    );
    expect(wrapper).not.toHaveClass("-mx-3");
  });

  it("wears the rounded-full pill shape", () => {
    render(<PreviewBanner preview="gio/apply-previews" />);
    expect(screen.getByRole("status")).toHaveClass("rounded-full");
  });

  it("maps preview statuses onto the primitive's generic tones", () => {
    // added → success (emerald), changed → warning (amber), removed → danger
    // (red), unchanged → info (sky); the primitive stays domain-agnostic and the
    // consumer attributes the meaning. On the pill the tone rides on the border.
    const cases = [
      ["added", "border-emerald-500/40"],
      ["changed", "border-amber-500/40"],
      ["removed", "border-red-500/40"],
      ["unchanged", "border-sky-500/40"],
    ] as const;
    for (const [status, toneClass] of cases) {
      const { unmount } = render(
        <PreviewBanner preview="gio/apply-previews" status={status} />,
      );
      expect(screen.getByRole("status")).toHaveClass(toneClass);
      unmount();
    }
  });

  it("falls back to the info tone with no per-resource status", () => {
    render(<PreviewBanner preview="gio/apply-previews" />);
    expect(screen.getByRole("status")).toHaveClass("border-sky-500/40");
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
