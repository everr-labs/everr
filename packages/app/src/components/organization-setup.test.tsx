import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  router: {
    invalidate: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/data/auth", () => ({
  getActiveOrganization: mocks.getOrganization,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useListOrganizations: () => ({
      data: [
        { id: "pending", name: "Pending" },
        { id: "other", name: "Other" },
      ],
    }),
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => mocks.router,
  useSearch: () => ({ returnTo: "/logs?service=api" }),
  useRouteContext: () => ({
    session: { session: { activeOrganizationId: "pending" } },
  }),
}));

import { OrganizationSetup } from "./organization-setup";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => vi.useRealTimers());

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <OrganizationSetup />
    </QueryClientProvider>,
  );
  return client;
}

it("keeps the setup message free of inline organization switch buttons", async () => {
  mocks.getOrganization.mockResolvedValue({
    id: "pending",
    clickhouseReady: false,
  });
  show();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "You'll be taken into Everr automatically when it's ready.",
  );
  expect(screen.queryByRole("link", { name: "Account settings" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Switch to Other" })).toBeNull();
  expect(mocks.router.invalidate).not.toHaveBeenCalled();
});

it("refreshes the route when a subsequent status check becomes ready", async () => {
  mocks.getOrganization.mockResolvedValue({
    id: "pending",
    clickhouseReady: false,
  });
  const client = show();
  await waitFor(() =>
    expect(
      client.getQueryData(["organization-provisioning", "pending"]),
    ).toEqual({ id: "pending", clickhouseReady: false }),
  );
  vi.useFakeTimers();
  mocks.getOrganization.mockResolvedValue({
    id: "pending",
    clickhouseReady: true,
  });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ["organization-provisioning", "pending"],
    });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(mocks.router.navigate).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(mocks.router.navigate).toHaveBeenCalledWith({
    href: "/logs?service=api",
    replace: true,
  });
});

it("keeps the friendly page visible when a readiness check fails", async () => {
  mocks.getOrganization.mockRejectedValue(new Error("Network unavailable"));
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't check your setup status.",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "You'll be taken into Everr automatically when it's ready.",
  );
  expect(mocks.router.invalidate).not.toHaveBeenCalled();
});

it("returns to organization selection if membership is revoked while waiting", async () => {
  mocks.getOrganization.mockRejectedValue(
    new Error("User is not a member of the organization"),
  );
  show();
  await waitFor(() =>
    expect(mocks.router.navigate).toHaveBeenCalledWith({
      to: "/choose-organization",
      search: { returnTo: "/logs?service=api" },
      replace: true,
    }),
  );
});
