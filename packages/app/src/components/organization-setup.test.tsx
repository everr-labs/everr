import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  retry: vi.fn(),
  router: {
    invalidate: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/data/organization-provisioning", () => ({
  completeOrganizationSetup: vi.fn().mockResolvedValue(undefined),
  getOrganizationProvisioningStatus: mocks.getOrganization,
  retryOrganizationProvisioning: mocks.retry,
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
    status: "pending",
  });
  show();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "We're setting up your organization. You'll be taken into Everr when it's ready.",
  );
  expect(screen.queryByRole("link", { name: "Account settings" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Switch to Other" })).toBeNull();
  expect(mocks.router.invalidate).not.toHaveBeenCalled();
});

it("refreshes the route when a subsequent status check becomes ready", async () => {
  mocks.getOrganization.mockResolvedValue({
    id: "pending",
    status: "pending",
  });
  const client = show();
  await waitFor(() =>
    expect(
      client.getQueryData(["organization-provisioning", "pending"]),
    ).toEqual({ id: "pending", status: "pending" }),
  );
  vi.useFakeTimers();
  mocks.getOrganization.mockResolvedValue({
    id: "pending",
    status: "ready",
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
  const client = show();
  await waitFor(() =>
    expect(
      client.getQueryState(["organization-provisioning", "pending"])?.status,
    ).toBe("error"),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(
    "We're setting up your organization. You'll be taken into Everr when it's ready.",
  );
  expect(mocks.router.invalidate).not.toHaveBeenCalled();
});

it("returns to organization selection if membership is revoked while waiting", async () => {
  mocks.getOrganization.mockResolvedValue(null);
  show();
  await waitFor(() =>
    expect(mocks.router.navigate).toHaveBeenCalledWith({
      to: "/choose-organization",
      search: { returnTo: "/logs?service=api" },
      replace: true,
    }),
  );
});

it("resumes polling after Try again even if the first status request fails", async () => {
  vi.useFakeTimers();
  mocks.getOrganization.mockResolvedValue({ id: "pending", status: "failed" });
  mocks.retry.mockImplementation(async () => {
    mocks.getOrganization.mockRejectedValueOnce(
      new Error("Network unavailable"),
    );
    mocks.getOrganization.mockResolvedValue({
      id: "pending",
      status: "pending",
    });
  });
  show();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(
    screen.getByRole("heading", {
      name: "We couldn't finish setting up your organization",
    }),
  ).toBeVisible();
  const calls = mocks.getOrganization.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(mocks.getOrganization).toHaveBeenCalledTimes(calls);
  expect(mocks.router.navigate).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(mocks.retry).toHaveBeenCalledWith({
    data: { organizationId: "pending" },
  });
  expect(
    screen.getByRole("heading", { name: "Getting your space ready" }),
  ).toBeVisible();
  const resumed = mocks.getOrganization.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(mocks.getOrganization.mock.calls.length).toBeGreaterThan(resumed);
});
