import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createFileRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/data/organizations", () => ({
  completeProOrganizationCheckout: mocks.complete,
}));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

let authenticated = false;
for (const path of Object.keys(import.meta.glob("./routes/**/*.{ts,tsx}"))) {
  if (path.endsWith("/organizations.checkout.success.tsx")) continue;
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

it("retains the checkout ID through sign-in and resumes organization completion", async () => {
  const checkoutId = "b8d32b2c-616f-4ff4-8b36-8c88b0a10837";
  const returnUrl = `/organizations/checkout/success?checkout_id=${checkoutId}`;
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
  await router.navigate({ to: search.get("redirect") ?? "/" });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Pro organization ready")).toBeVisible();
  expect(mocks.complete).toHaveBeenCalledWith({ data: { checkoutId } });
  expect(
    screen.getByRole("button", { name: "Open organization" }),
  ).toBeEnabled();
  queryClient.clear();
});
