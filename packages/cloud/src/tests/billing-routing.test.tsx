import { productRouteFiles, sharedRouteModules } from "@everr/app/testing/routes";
import {
  createFileRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const billing = vi.hoisted(() => ({
  getSuspendedOrgRecovery: vi.fn(),
}));
const organization = vi.hoisted(() => ({ memberRole: "owner" }));

vi.mock("../data/billing", () => ({
  ...billing,
  getOrgEntitlement: vi.fn(),
  getOrgPortalUrl: vi.fn(),
  startOrgCheckout: vi.fn(),
  downgradeSuspendedOrganization: vi.fn(),
}));
vi.mock("@everr/app/identity/client", () => ({
  authClient: { useActiveOrganization: () => ({ data: null }) },
}));

// Keep the generated topology, the organization guard, and the suspended
// billing route. Other pages are irrelevant here and would pull in unrelated
// server dependencies.
for (const path of [
  ...productRouteFiles,
  ...Object.keys(import.meta.glob("../routes/**/*.{ts,tsx}")).map(
    (path) => new URL(path, import.meta.url).pathname,
  ),
]) {
  if (path.endsWith("/_admin.tsx") || path.endsWith("/billing_.suspended.tsx")) continue;
  vi.doMock(path, () => ({
    Route:
      path === sharedRouteModules.root
        ? createRootRoute({ beforeLoad: () => ({ memberRole: organization.memberRole }) })
        : createFileRoute()({}),
  }));
}

const { routeTree } = await import("@composition/routes");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function visit(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

test.each(["owner", "admin", "member"])(
  "a suspended %s can see recovery without entering the billing admin route",
  async (role) => {
    organization.memberRole = role;
    billing.getSuspendedOrgRecovery.mockResolvedValue({
      entitlement: { appState: "suspended" },
      canManageBilling: role !== "member",
      canDowngrade: role === "owner",
      ownsAnotherHobby: false,
    });

    await visit("/billing/suspended");

    expect(await screen.findByText("Pro subscription suspended")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Manage billing" }) !== null).toBe(
      role !== "member",
    );
    expect(screen.queryByRole("button", { name: "Downgrade to Hobby" }) !== null).toBe(
      role === "owner",
    );
    expect(
      screen.queryByText("Contact an organization Owner or Admin to restore billing.") !== null,
    ).toBe(role === "member");
  },
);

test.each(["/billing", "/api-keys", "/github", "/users-management"])(
  "%s shows unauthorized without changing the URL",
  async (path) => {
    organization.memberRole = "member";
    const router = await visit(path);
    expect(await screen.findByRole("heading", { name: "Not authorized" })).toBeVisible();
    expect(router.state.location.pathname).toBe(path);
    expect(billing.getSuspendedOrgRecovery).not.toHaveBeenCalled();
  },
);

test.each(["hobby", "pro"])("%s organizations leave recovery", async (appState) => {
  billing.getSuspendedOrgRecovery.mockResolvedValue({
    entitlement: { appState },
  });
  const router = await visit("/billing/suspended");
  expect(router.state.location.pathname).toBe("/");
  expect(screen.queryByText("Pro subscription suspended")).not.toBeInTheDocument();
});

import { QueryClient } from "@tanstack/react-query";
