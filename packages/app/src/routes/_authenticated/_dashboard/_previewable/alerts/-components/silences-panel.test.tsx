import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertingSilence } from "@/data/alerting/types";
import {
  SilenceCreateDrawer,
  type SilenceDrawerHandle,
  SilencesPanel,
} from "./silences-panel";

const mocks = vi.hoisted(() => ({
  listAlertingSilences: vi.fn(),
  createAlertingSilence: vi.fn(),
  deleteAlertingSilence: vi.fn(),
  listAlertingLabelKeys: vi.fn().mockResolvedValue([]),
  listAlertingLabelValues: vi.fn().mockResolvedValue([]),
  listAlertingRules: vi.fn().mockResolvedValue([]),
  listAlertingSlos: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/data/alerting/server", () => ({
  listAlertingSilences: mocks.listAlertingSilences,
  createAlertingSilence: mocks.createAlertingSilence,
  deleteAlertingSilence: mocks.deleteAlertingSilence,
  listAlertingLabelKeys: mocks.listAlertingLabelKeys,
  listAlertingLabelValues: mocks.listAlertingLabelValues,
  listAlertingRules: mocks.listAlertingRules,
  listAlertingSlos: mocks.listAlertingSlos,
}));

function alertingSilence(
  overrides: Partial<AlertingSilence> = {},
): AlertingSilence {
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

function activeSilence(
  overrides: Partial<AlertingSilence> = {},
): AlertingSilence {
  return alertingSilence({
    starts_at: new Date(Date.now() - 3_600_000).toISOString(),
    ends_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  });
}

// Conditions resolves rule/slo matcher values through preview-scoped queries
// (usePreview reads the _dashboard search), so the panel needs a router whose
// tree carries the _authenticated/_dashboard layout ids.
function renderPanel(onNewSilence = vi.fn()) {
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
  const panelRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "/",
    component: () => <SilencesPanel onNewSilence={onNewSilence} />,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([dashboardRoute.addChildren([panelRoute])]),
  ]);

  const history = createMemoryHistory({ initialEntries: ["/"] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({ routeTree, history, context: { queryClient } });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { onNewSilence };
}

describe("SilencesPanel", () => {
  beforeEach(() => {
    mocks.listAlertingSilences.mockReset();
    mocks.createAlertingSilence.mockReset();
    mocks.deleteAlertingSilence.mockReset();
  });

  it("cancels a silence that is still ahead of its end, but not an expired one", async () => {
    mocks.listAlertingSilences.mockResolvedValue([
      activeSilence({ id: "sil-active", comment: "now" }),
      alertingSilence({
        id: "sil-scheduled",
        comment: "later",
        starts_at: new Date(Date.now() + 3_600_000).toISOString(),
        ends_at: new Date(Date.now() + 7_200_000).toISOString(),
      }),
      alertingSilence({ id: "sil-expired", comment: "done" }),
    ]);
    mocks.deleteAlertingSilence.mockResolvedValue({ deleted: true });
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
    expect(mocks.deleteAlertingSilence).toHaveBeenCalledWith({
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

  it("locks seeded matchers while keeping added matchers editable", async () => {
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
      ref.current?.openWith([{ label: "rule", op: "eq", value: "rule-1" }], {
        lockSeed: true,
        seedValueLabels: ["Always firing (demo)"],
      });
    });

    expect(
      await screen.findByRole("combobox", { name: "Matcher label" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Matcher operator" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Matcher value" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Matcher value" }),
    ).toHaveTextContent("Always firing (demo)");
    expect(screen.getByLabelText("Matcher 1 is locked")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove condition 1" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(
      screen.getAllByRole("combobox", { name: "Matcher label" })[1],
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Remove condition 2" }),
    ).toBeEnabled();
  });
});
