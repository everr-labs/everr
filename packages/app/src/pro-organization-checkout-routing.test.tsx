vi.mock("@/data/organization-access", () => ({
  getActiveOrganizationAccess: vi.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createFileRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  select: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock("@/data/organizations", () => ({
  completeProOrganizationCheckout: mocks.complete,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: { setActive: mocks.select },
  },
}));

let authenticated = false;
for (const path of Object.keys(import.meta.glob("./routes/**/*.{ts,tsx}"))) {
  if (
    path.endsWith("/organizations.checkout.success.tsx") ||
    path.endsWith("/_welcome/_signedIn.tsx")
  )
    continue;
  vi.doMock(path, () => ({
    Route:
      path === "./routes/__root.tsx"
        ? createRootRoute({
            beforeLoad: () => ({
              session: authenticated ? { user: { id: "owner" } } : null,
            }),
          })
        : createFileRoute()({}),
  }));
}
const { routeTree } = await import("./routeTree.gen");
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authenticated = false;
});

it.each([
  [
    "/cli/authorize?user_code=ABCD-EFGH&next=%2Flogs#confirm",
    "/cli/authorize?user_code=ABCD-EFGH&next=%2Flogs#confirm",
  ],
  [undefined, "/"],
  ["https://other.example", "/"],
  ["//other.example", "/"],
  ["/organization-setup", "/"],
])("retains the checkout ID and safe destination (%s) through sign-in and organization completion", async (returnTo, destination) => {
  const checkoutId = "b8d32b2c-616f-4ff4-8b36-8c88b0a10837";
  const returnUrl = `/organizations/checkout/success?checkout_id=${checkoutId}${returnTo === undefined ? "" : `&returnTo=${encodeURIComponent(returnTo)}`}`;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [returnUrl] }),
  });
  await router.load();
  expect(router.state.location.pathname).toBe("/auth/sign-in");
  const search = new URLSearchParams(router.state.location.searchStr);
  expect(search.get("redirect")).toBe(returnUrl);
  expect(mocks.complete).not.toHaveBeenCalled();

  authenticated = true;
  mocks.complete.mockResolvedValue({
    status: "completed",
    organization: { id: "org", name: "Acme" },
  });
  const queryKey = ["panel-query", "usage"];
  queryClient.setQueryData(queryKey, [{ organization: "previous" }]);
  await router.navigate({ to: search.get("redirect") ?? "/" });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/organization-setup"),
  );
  expect(mocks.complete).toHaveBeenCalledWith({ data: { checkoutId } });
  expect(mocks.select).toHaveBeenCalledWith({ organizationId: "org" });
  expect(
    screen.queryByRole("button", { name: "Open organization" }),
  ).toBeNull();
  const queryFn = vi.fn().mockResolvedValue([{ organization: "org" }]);
  expect(
    await queryClient.fetchQuery({ queryKey, queryFn, staleTime: Infinity }),
  ).toEqual([{ organization: "org" }]);
  expect(queryFn).toHaveBeenCalledOnce();
  expect(router.state.location.pathname).toBe("/organization-setup");
  expect(
    new URLSearchParams(router.state.location.searchStr).get("returnTo"),
  ).toBe(destination);
  queryClient.clear();
});

it("shows the shared setup view while payment confirmation is pending", async () => {
  authenticated = true;
  mocks.complete.mockResolvedValue({ status: "pending" });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({
      initialEntries: ["/organizations/checkout/success?checkout_id=pending"],
    }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Getting your space ready" }),
  ).toBeVisible();
  expect(screen.queryByText("Finalizing organization")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Open organization" }),
  ).toBeNull();
  expect(mocks.select).not.toHaveBeenCalled();
  queryClient.clear();
});
