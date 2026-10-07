import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { CLICKHOUSE_SETUP_MESSAGE } from "@/common/clickhouse-provisioning";

const mocks = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  router: { invalidate: vi.fn() },
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
  useRouteContext: () => ({
    session: { session: { activeOrganizationId: "pending" } },
  }),
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/account">{children}</a>
  ),
}));

import { OrganizationSetup } from "./organization-setup";

beforeEach(() => {
  vi.clearAllMocks();
});

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

it("shows the setup message and permits account access and switching to another organization", async () => {
  mocks.getOrganization.mockResolvedValue({
    id: "pending",
    clickhouseReady: false,
  });
  show();
  expect(await screen.findByRole("status")).toHaveTextContent(
    CLICKHOUSE_SETUP_MESSAGE,
  );
  expect(
    screen.getByRole("link", { name: "Account settings" }),
  ).toHaveAttribute("href", "/account");
  expect(screen.getByRole("button", { name: "Switch to Other" })).toBeVisible();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Switch to Pending" }),
    ).toBeNull(),
  );
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
  mocks.getOrganization.mockResolvedValue({
    id: "pending",
    clickhouseReady: true,
  });
  await client.invalidateQueries({
    queryKey: ["organization-provisioning", "pending"],
  });
  await waitFor(() => expect(mocks.router.invalidate).toHaveBeenCalled());
});

it("keeps the friendly page visible when a readiness check fails", async () => {
  mocks.getOrganization.mockRejectedValue(new Error("Network unavailable"));
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't check your setup status.",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    CLICKHOUSE_SETUP_MESSAGE,
  );
  expect(mocks.router.invalidate).not.toHaveBeenCalled();
});
