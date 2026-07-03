import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  reduceMotion: false,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

// framer-motion's real useReducedMotion probes matchMedia once per module
// lifetime and caches the answer, so a per-test matchMedia mock installed after
// the first render can never flip it. Mock the hook itself so the component's
// reduced-motion branch actually executes when a test asks for it.
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => mocks.reduceMotion };
});

import { PreviewBanner } from "./preview-banner";
import {
  __resetPreviewDismissals,
  hasEntrancePlayed,
  markEntrancePlayed,
} from "./preview-dismissals";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reduceMotion = false;
  __resetPreviewDismissals();
});

afterEach(() => {
  __resetPreviewDismissals();
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

  it("floats the pill via a centered, zero-height, fixed lane so content scrolls under it", () => {
    render(<PreviewBanner preview="gio/apply-previews" />);
    // The pill sits in a viewport-fixed, centered lane that reserves no height
    // (`h-0`), so it floats over the content rather than pushing it down.
    // `fixed` — not sticky — keeps it out of the macOS rubber-band, which only
    // translates in-flow content; `top-14` pins it 8px under the fixed h-12
    // topnav; `items-start` keeps the h-0 lane from stretch-squashing the pill;
    // `px-3` matches the content inset so the pill stays off the viewport
    // edges; `pointer-events-none` lets clicks reach the content beneath.
    const wrapper = screen.getByRole("status").parentElement;
    expect(wrapper).toHaveClass(
      "fixed",
      "top-14",
      "flex",
      "items-start",
      "justify-center",
      "h-0",
      "px-3",
      "pointer-events-none",
    );
    expect(wrapper).not.toHaveClass("sticky", "-mt-2", "-mb-1", "-mx-3");
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

  it("offers a Dismiss action distinct from Exit that never navigates", async () => {
    render(<PreviewBanner preview="gio/apply-previews" />);
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    const exit = screen.getByRole("button", { name: /exit preview/i });
    // Two separate affordances — dismiss is not the exit button.
    expect(dismiss).not.toBe(exit);

    await userEvent.click(dismiss);
    // Dismissing hides the pill without touching the URL (stays in preview mode).
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps the pill hidden after a re-render (dismissal survives navigation)", async () => {
    const { rerender } = render(<PreviewBanner preview="gio/apply-previews" />);
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );

    // A client-side navigation re-renders the same still-active preview; the
    // in-memory dismissal keeps the pill hidden (no reappearance without a full
    // reload).
    rerender(<PreviewBanner preview="gio/apply-previews" status="changed" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keys dismissal by preview name — a different preview shows the pill again", async () => {
    const { rerender } = render(<PreviewBanner preview="gio/apply-previews" />);
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );

    // Switching to a different preview name is a fresh pill: its name isn't in
    // the dismissed set, so it renders.
    rerender(<PreviewBanner preview="gio/other-preview" />);
    expect(screen.getByRole("status")).toHaveTextContent("gio/other-preview");
  });

  it("plays the entrance once per preview name, so navigation doesn't replay it", () => {
    // Every page mounts its own banner; the module-level flag is what makes the
    // pill read as one persistent element across client-side navigations.
    expect(hasEntrancePlayed("gio/apply-previews")).toBe(false);
    markEntrancePlayed("gio/apply-previews");
    expect(hasEntrancePlayed("gio/apply-previews")).toBe(true);
    // A different preview is a fresh appearance.
    expect(hasEntrancePlayed("gio/other-preview")).toBe(false);
    // The test-reset helper clears it (full-reload semantics).
    __resetPreviewDismissals();
    expect(hasEntrancePlayed("gio/apply-previews")).toBe(false);
  });

  it("respects reduced motion: still renders and dismisses instantly", async () => {
    // Drives the component's actual reduceMotion branch (initial=false,
    // opacity-only targets, zero duration) via the mocked hook above — the
    // real hook's module-level matchMedia cache makes it unmockable per-test.
    mocks.reduceMotion = true;
    render(<PreviewBanner preview="gio/apply-previews" />);
    // Visible on load under reduced motion (no gated-on-transition blank).
    expect(screen.getByRole("status")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
});
