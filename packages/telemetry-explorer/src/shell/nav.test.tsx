import { SidebarProvider } from "@everr/ui/components/sidebar";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { BellOff, Flame, Hash, House } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";
import { type NavGroup, NavMain } from "./nav";

const navGroups: NavGroup[] = [
  { accent: "", items: [{ title: "Home", url: "/", icon: House, exact: true }] },
  {
    label: "Alerts",
    accent: "",
    items: [
      { title: "Triage", url: "/alerts", icon: Flame, exact: true },
      { title: "Silences", url: "/alerts/silences", icon: BellOff },
      { title: "Notifications", url: "/alerts/notifications", icon: Hash },
    ],
  },
];

/** Renders the sidebar nav at a URL, over a route tree carrying just the
 *  paths the assertions navigate to. The nav reads the location, not the
 *  matched route, so stub components are enough. */
function renderNav(initialEntry: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider>
        <NavMain groups={navGroups} />
        <Outlet />
      </SidebarProvider>
    ),
  });
  const paths = ["/", "/alerts", "/alerts/silences", "/alerts/notifications"];
  const routeTree = rootRoute.addChildren(
    paths.map((path) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        component: () => null,
      }),
    ),
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(<RouterProvider router={router} />);
}

function activeLinkNames() {
  return screen
    .getAllByRole("link")
    .filter((el) => el.getAttribute("data-active") === "true")
    .map((el) => el.textContent);
}

describe("sidebar nav active state", () => {
  it("marks exactly Silences active on the silences page", async () => {
    renderNav("/alerts/silences");

    await screen.findByText("Silences");
    expect(activeLinkNames()).toEqual(["Silences"]);
  });

  // The rule inventory lives on the Triage page, so an alert detail URL is a
  // Triage URL: no second destination may light up for it.
  it("keeps Triage active with an alert open in the detail panel", async () => {
    renderNav("/alerts?alert=default/eventloop-delay");

    await screen.findByText("Triage");
    expect(activeLinkNames()).toEqual(["Triage"]);
  });
});
