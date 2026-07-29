import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcSilence } from "@/data/cc/types";
import {
  SilenceCreateDrawer,
  type SilenceDrawerHandle,
  SilencesPanel,
} from "./silences-panel";

// ---------------------------------------------------------------------------
// Mocks, at the same module boundary as the route tests.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcSilences: vi.fn(),
  createCcSilence: vi.fn(),
  deleteCcSilence: vi.fn(),
  listCcLabelKeys: vi.fn().mockResolvedValue([]),
  listCcLabelValues: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/data/cc/server", () => ({
  listCcSilences: mocks.listCcSilences,
  createCcSilence: mocks.createCcSilence,
  deleteCcSilence: mocks.deleteCcSilence,
  listCcLabelKeys: mocks.listCcLabelKeys,
  listCcLabelValues: mocks.listCcLabelValues,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ccSilence(overrides: Partial<CcSilence> = {}): CcSilence {
  return {
    id: "sil-1",
    tenant: "org1",
    matchers: [{ label: "host", op: "eq", value: "web-1" }],
    starts_at: "2026-06-14T00:00:00Z",
    ends_at: "2026-06-14T01:00:00Z",
    comment: "maintenance",
    author: null,
    created_at: "2026-06-13T23:00:00Z",
    ...overrides,
  };
}

/** An active silence relative to the real clock. */
function activeSilence(overrides: Partial<CcSilence> = {}): CcSilence {
  return ccSilence({
    starts_at: new Date(Date.now() - 3_600_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderPanel(onNewSilence = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SilencesPanel onNewSilence={onNewSilence} />
    </QueryClientProvider>,
  );
  return { onNewSilence };
}

describe("SilencesPanel", () => {
  beforeEach(() => {
    mocks.listCcSilences.mockReset();
    mocks.createCcSilence.mockReset();
    mocks.deleteCcSilence.mockReset();
  });

  it("offers Cancel on active and scheduled silences but not on expired ones", async () => {
    mocks.listCcSilences.mockResolvedValue([
      activeSilence({ id: "sil-active", comment: "now" }),
      ccSilence({ id: "sil-expired", comment: "done" }),
    ]);

    renderPanel();

    await screen.findByText("now");
    const activeRow = screen.getByText("now").closest("tr");
    const expiredRow = screen.getByText("done").closest("tr");
    expect(activeRow).not.toBeNull();
    expect(expiredRow).not.toBeNull();
    expect(
      within(activeRow as HTMLElement).getByRole("button", {
        name: "Cancel",
      }),
    ).toBeInTheDocument();
    expect(
      within(expiredRow as HTMLElement).queryByRole("button", {
        name: "Cancel",
      }),
    ).not.toBeInTheDocument();
  });

  it("cancels a silence via deleteCcSilence", async () => {
    mocks.listCcSilences.mockResolvedValue([
      activeSilence({ id: "sil-active", comment: "now" }),
    ]);
    mocks.deleteCcSilence.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();

    renderPanel();

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mocks.deleteCcSilence).toHaveBeenCalledWith({
      data: { id: "sil-active" },
    });
  });

  it("keeps Create disabled while any matcher is missing its label", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ref = createRef<SilenceDrawerHandle>();
    render(
      <QueryClientProvider client={queryClient}>
        <SilenceCreateDrawer ref={ref} />
      </QueryClientProvider>,
    );

    // Seeded with a labelled matcher: creatable once the window is set.
    act(() => {
      ref.current?.openWith([{ label: "host", op: "eq", value: "web-1" }]);
    });
    const create = await screen.findByRole("button", {
      name: "Create silence",
    });
    await user.click(screen.getByRole("button", { name: "8h" }));
    expect(create).toBeEnabled();

    // An added row has an empty label, which would match every alert; the
    // form must not allow submitting it.
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(create).toBeDisabled();
  });

  it("hands New silence to the page-owned drawer", async () => {
    mocks.listCcSilences.mockResolvedValue([]);
    const user = userEvent.setup();

    const { onNewSilence } = renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /New silence/ }),
    );

    expect(onNewSilence).toHaveBeenCalled();
  });
});
