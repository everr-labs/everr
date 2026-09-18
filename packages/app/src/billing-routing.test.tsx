import {
  createFileRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const billing = vi.hoisted(() => ({
  ensureOrgBillingAdmin: vi.fn(),
  getSuspendedOrgRecovery: vi.fn(),
}));

vi.mock("@/data/billing", () => ({
  ...billing,
  NotBillingAdminError: class NotBillingAdminError extends Error {},
  getOrgEntitlement: vi.fn(),
  getOrgPortalUrl: vi.fn(),
  startOrgCheckout: vi.fn(),
  downgradeSuspendedOrganization: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useActiveOrganization: () => ({ data: null }) },
}));

// Keep the generated topology and real billing routes. Other pages and
// layouts are irrelevant here and would pull in unrelated server dependencies.
for (const path of Object.keys(import.meta.glob("./routes/**/*.{ts,tsx}"))) {
  if (/\/billing(?:_)?(?:\.suspended)?\.tsx$/.test(path)) continue;
  vi.doMock(path, () => ({
    Route:
      path === "./routes/__root.tsx"
        ? createRootRoute()
        : createFileRoute()({}),
  }));
}

const { routeTree } = await import("./routeTree.gen");

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

test.each([
  "owner",
  "admin",
  "member",
])("a suspended %s can see recovery without entering the billing admin route", async (role) => {
  billing.ensureOrgBillingAdmin.mockRejectedValue(
    new Error("The recovery page must not require billing admin access"),
  );
  billing.getSuspendedOrgRecovery.mockResolvedValue({
    entitlement: { appState: "suspended" },
    canManageBilling: role !== "member",
    canDowngrade: role === "owner",
    ownsAnotherHobby: false,
  });

  await visit("/billing/suspended");

  expect(await screen.findByText("Pro subscription suspended")).toBeVisible();
  expect(billing.ensureOrgBillingAdmin).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Manage billing" }) !== null,
  ).toBe(role !== "member");
  expect(
    screen.queryByRole("button", { name: "Downgrade to Hobby" }) !== null,
  ).toBe(role === "owner");
  if (role === "member") {
    expect(
      screen.getByText(
        "Contact an organization Owner or Admin to restore billing.",
      ),
    ).toBeVisible();
  }
});

test("ordinary billing shows unauthorized without changing the URL", async () => {
  billing.ensureOrgBillingAdmin.mockRejectedValue(new Error("Not authorized"));
  const router = await visit("/billing");
  expect(
    await screen.findByRole("heading", { name: "Not authorized" }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe("/billing");
  expect(billing.ensureOrgBillingAdmin).toHaveBeenCalledOnce();
  expect(billing.getSuspendedOrgRecovery).not.toHaveBeenCalled();
});

test.each([
  "hobby",
  "pro",
])("%s organizations leave recovery", async (appState) => {
  billing.getSuspendedOrgRecovery.mockResolvedValue({
    entitlement: { appState },
  });
  const router = await visit("/billing/suspended");
  expect(router.state.location.pathname).toBe("/");
  expect(
    screen.queryByText("Pro subscription suspended"),
  ).not.toBeInTheDocument();
});

import { QueryClient } from "@tanstack/react-query";
