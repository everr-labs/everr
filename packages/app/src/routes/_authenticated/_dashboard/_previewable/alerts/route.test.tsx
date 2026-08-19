import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
// The layout route lives at `../alerts.tsx`, the pathless-sibling file next to
// this `alerts/` directory: adding a second `alerts/route.tsx` would define the
// same route id twice and break route generation. This file still tests the
// section layout, just from where it actually lives.
import { Route as AlertsSectionFileRoute } from "../alerts";
import { Route as AlertsIndexFileRoute } from "./index";
import { Route as AlertsRulesFileRoute } from "./rules";
import { Route as AlertsRuleDetailFileRoute } from "./rules_.$project.$slug";

/** jsdom does not implement `window.matchMedia` at all. `useMediaQuery` reads
 *  it through a guard that falls back to `?? false` when it is missing, and
 *  `false` is what the narrow-window query resolves to, so wide is the
 *  default without this stub. Only a narrow-window test needs it. */
function matchMediaMock(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

function renderAlertsLayout(options: { initialEntry?: string } = {}) {
  const { initialEntry = "/alerts" } = options;
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
  const alertsLayoutRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "alerts",
    component: AlertsSectionFileRoute.options.component,
  });
  const indexRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "/",
    component: AlertsIndexFileRoute.options.component,
  });
  const rulesRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "rules",
    component: AlertsRulesFileRoute.options.component,
  });
  const ruleDetailRoute = createRoute({
    getParentRoute: () => alertsLayoutRoute,
    path: "rules/$project/$slug",
    component: AlertsRuleDetailFileRoute.options.component,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        alertsLayoutRoute.addChildren([
          indexRoute,
          rulesRoute,
          ruleDetailRoute,
        ]),
      ]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: [initialEntry] });
  const router = createRouter({ routeTree, history });

  render(<RouterProvider router={router} />);
  return { router };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("alerts section nav", () => {
  it("marks exactly one destination active, and Triage is not active on All Rules", async () => {
    renderAlertsLayout({ initialEntry: "/alerts/rules" });

    const nav = await screen.findByRole("navigation", { name: "Alerting" });
    const active = within(nav)
      .getAllByRole("link")
      .filter((el) => el.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("All Rules");
  });

  it("keeps All Rules active on a rule detail URL", async () => {
    renderAlertsLayout({ initialEntry: "/alerts/rules/demo/flapping" });

    const nav = await screen.findByRole("navigation", { name: "Alerting" });
    const active = within(nav)
      .getAllByRole("link")
      .filter((el) => el.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("All Rules");
  });

  it("puts the nav behind a button on a narrow window", async () => {
    matchMediaMock(true); // NARROW_QUERY matches
    renderAlertsLayout({ initialEntry: "/alerts" });

    expect(
      await screen.findByRole("button", { name: "Alerting" }),
    ).toBeInTheDocument();
    // Exactly one instance of the nav exists at a time: on a narrow window it
    // lives inside the closed sheet, not rendered a second time beside the
    // button.
    expect(
      screen.queryByRole("navigation", { name: "Alerting" }),
    ).not.toBeInTheDocument();
  });

  it("closes the sheet after choosing a destination on a narrow window", async () => {
    matchMediaMock(true); // NARROW_QUERY matches
    const user = userEvent.setup();
    const { router } = renderAlertsLayout({ initialEntry: "/alerts" });

    await user.click(await screen.findByRole("button", { name: "Alerting" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("link", { name: "All Rules" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/alerts/rules"),
    );
    // A destination navigates AND dismisses the sheet: leaving it mounted
    // would strand the reader on the new page behind a modal overlay.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
