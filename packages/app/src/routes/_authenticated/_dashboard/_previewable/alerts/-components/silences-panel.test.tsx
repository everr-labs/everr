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

function activeSilence(overrides: Partial<CcSilence> = {}): CcSilence {
  return ccSilence({
    starts_at: new Date(Date.now() - 3_600_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  });
}

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

  it("cancels a silence that is still ahead of its end, but not an expired one", async () => {
    mocks.listCcSilences.mockResolvedValue([
      activeSilence({ id: "sil-active", comment: "now" }),
      ccSilence({
        id: "sil-scheduled",
        comment: "later",
        starts_at: new Date(Date.now() + 3_600_000).toISOString(),
        ends_at: new Date(Date.now() + 7_200_000).toISOString(),
      }),
      ccSilence({ id: "sil-expired", comment: "done" }),
    ]);
    mocks.deleteCcSilence.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();

    const { onNewSilence } = renderPanel();

    await screen.findByText("now");
    const row = (comment: string) =>
      screen.getByText(comment).closest("tr") as HTMLElement;

    expect(
      within(row("later")).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(
      within(row("done")).queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(row("now")).getByRole("button", { name: "Cancel" }),
    );
    expect(mocks.deleteCcSilence).toHaveBeenCalledWith({
      data: { id: "sil-active" },
    });

    // Creating is the page's job: the panel only asks for the drawer.
    await user.click(screen.getByRole("button", { name: /New silence/ }));
    expect(onNewSilence).toHaveBeenCalled();
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

    act(() => {
      ref.current?.openWith([{ label: "host", op: "eq", value: "web-1" }]);
    });
    const create = await screen.findByRole("button", {
      name: "Create silence",
    });
    await user.click(screen.getByRole("button", { name: "8h" }));
    expect(create).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(create).toBeDisabled();
  });
});
