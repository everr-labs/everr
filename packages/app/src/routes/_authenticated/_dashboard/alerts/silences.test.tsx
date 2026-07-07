import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcSilence } from "@/data/cc/types";
import { Route as SilencesFileRoute } from "./silences";

// ---------------------------------------------------------------------------
// Mocks, at the same module boundary as ../rules.test.tsx.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcSilences: vi.fn(),
  createCcSilence: vi.fn(),
  deleteCcSilence: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcSilences: mocks.listCcSilences,
  createCcSilence: mocks.createCcSilence,
  deleteCcSilence: mocks.deleteCcSilence,
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

function renderSilencesRoute() {
  const rootRoute = createRootRoute({ component: Outlet });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_authenticated",
    component: Outlet,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    id: "_dashboard",
    component: Outlet,
  });
  const silencesRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts/silences",
    component: SilencesFileRoute.options.component,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([silencesRoute]),
    ]),
  ]);

  const history = createMemoryHistory({
    initialEntries: ["/alerts/silences"],
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

describe("/alerts/silences route", () => {
  beforeEach(() => {
    mocks.listCcSilences.mockReset();
    mocks.createCcSilence.mockReset();
    mocks.deleteCcSilence.mockReset();
  });

  it("shows author and creation time as muted row metadata", async () => {
    mocks.listCcSilences.mockResolvedValue([ccSilence({ author: "alice" })]);

    renderSilencesRoute();

    expect(await screen.findByText("maintenance")).toBeInTheDocument();
    const meta = screen.getByText(/by alice · created /);
    expect(meta).toBeInTheDocument();
    // Formatted like the row's other timestamps (ccFormatTs → toLocaleString).
    expect(meta.textContent).toContain(
      new Date("2026-06-13T23:00:00Z").toLocaleString(),
    );
  });

  it("omits the author fragment when the silence has none", async () => {
    mocks.listCcSilences.mockResolvedValue([ccSilence()]);

    renderSilencesRoute();

    expect(await screen.findByText("maintenance")).toBeInTheDocument();
    expect(screen.queryByText(/by /)).not.toBeInTheDocument();
    expect(screen.getByText(/created /)).toBeInTheDocument();
  });

  it("groups silences into Active, Scheduled, and Recently expired", async () => {
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

    renderSilencesRoute();

    expect(
      await screen.findByRole("heading", { name: "Active" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Scheduled" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recently expired" }),
    ).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("scheduled")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
  });

  it("offers Cancel on active and scheduled silences but not on expired ones", async () => {
    mocks.listCcSilences.mockResolvedValue([
      activeSilence({ id: "sil-active", comment: "now" }),
      ccSilence({ id: "sil-expired", comment: "done" }),
    ]);

    renderSilencesRoute();

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

    renderSilencesRoute();

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mocks.deleteCcSilence).toHaveBeenCalledWith({
      data: { id: "sil-active" },
    });
  });

  it("renders matchers as pills with real operator symbols", async () => {
    mocks.listCcSilences.mockResolvedValue([
      activeSilence({
        matchers: [{ label: "rule", op: "eq", value: "rule-1" }],
      }),
    ]);

    renderSilencesRoute();

    expect(await screen.findByText("rule")).toBeInTheDocument();
    expect(screen.getByText("=")).toBeInTheDocument();
    expect(screen.getByText("rule-1")).toBeInTheDocument();
  });
});
