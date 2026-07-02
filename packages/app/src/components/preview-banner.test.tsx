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

  it("pins the banner via a sticky, opaque, full-bleed wrapper so content scrolls under it", () => {
    render(<PreviewBanner preview="gio/apply-previews" />);
    // The status band sits inside a sticky wrapper; the opaque background keeps
    // content readable as it slides beneath the pinned banner, and the negative
    // margins cancel the `_dashboard` column's `p-3` so the band spans edge-to-
    // edge and sits flush under the header.
    const wrapper = screen.getByRole("status").parentElement;
    expect(wrapper).toHaveClass(
      "sticky",
      "top-0",
      "bg-background",
      "-mx-3",
      "-mt-3",
    );
  });

  it("maps preview statuses onto the primitive's generic tones", () => {
    // added → success (emerald), changed → warning (amber), removed → danger
    // (red), unchanged → info (sky); the primitive stays domain-agnostic and the
    // consumer attributes the meaning.
    const cases = [
      ["added", "bg-emerald-500/10"],
      ["changed", "bg-amber-500/10"],
      ["removed", "bg-red-500/10"],
      ["unchanged", "bg-sky-500/10"],
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
    expect(screen.getByRole("status")).toHaveClass("bg-sky-500/10");
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
