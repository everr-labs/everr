import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organizations: [
    {
      id: "removed",
      name: "Removed organization",
      slug: "removed",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
  invalidate: vi.fn(),
  refetch: () => Promise.resolve(),
}));

vi.mock("@/lib/auth-client", async () => {
  const { createAuthClient } = await import("better-auth/react");
  const { organizationClient } = await import("better-auth/client/plugins");
  const client = createAuthClient({
    baseURL: "http://localhost:5173",
    plugins: [organizationClient()],
    fetchOptions: {
      customFetchImpl: async (input) =>
        String(input).includes("/organization/set-active")
          ? new Response(
              JSON.stringify({
                message: "You are no longer a member",
                code: "FORBIDDEN",
              }),
              {
                status: 403,
                headers: { "Content-Type": "application/json" },
              },
            )
          : new Response(JSON.stringify(mocks.organizations), {
              headers: { "Content-Type": "application/json" },
            }),
    },
  });
  return {
    authClient: client,
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useRouter: () => ({
    invalidate: mocks.invalidate,
    navigate: mocks.invalidate,
  }),
  useSearch: () => ({ returnTo: "/logs" }),
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/account">{children}</a>
  ),
  ErrorComponent: () => null,
  redirect: vi.fn(),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: vi.fn() }));
vi.mock("@/data/auth", () => ({
  getActiveOrganization: vi.fn(),
}));
vi.mock("@/data/billing", () => ({
  getActiveOrgAppAccess: vi.fn(),
}));
vi.mock("@/data/organizations", () => ({
  createOrganization: vi.fn().mockResolvedValue({
    kind: "created",
    organization: { id: "new", name: "New organization" },
  }),
  getOrganizationCreationOptions: vi
    .fn()
    .mockResolvedValue({ canCreateHobby: true }),
}));

import { OrganizationSelection } from "@/components/organization-selection";
import { authClient } from "@/lib/auth-client";

function CachedOrganizationMenu() {
  const { data, refetch } = authClient.useListOrganizations();
  mocks.refetch = refetch;
  return <div>{data?.map((org) => org.name).join(", ")}</div>;
}

it("refreshes memberships when the chooser replaces a menu with cached organizations", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CachedOrganizationMenu />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Removed organization")).toBeVisible();

  mocks.organizations = [
    {
      id: "remaining",
      name: "Remaining organization",
      slug: "remaining",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <OrganizationSelection />
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("button", { name: "Remaining organization" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Removed organization" }),
  ).not.toBeInTheDocument();

  mocks.organizations = [];
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Remaining organization" }));
  expect(
    await screen.findByRole("heading", { name: "Let's get you settled" }),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "You are no longer a member",
  );
  expect(
    screen.getByRole("button", { name: "Create organization" }),
  ).toBeEnabled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});

it("keeps the setup step mounted when the new membership becomes visible", async () => {
  mocks.organizations = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CachedOrganizationMenu />
      <OrganizationSelection />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Let's get you settled" });
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Organization name"),
    "New organization",
  );
  await user.click(screen.getByRole("button", { name: "Create organization" }));
  await screen.findByRole("heading", { name: "Getting your space ready" });
  mocks.organizations = [
    {
      id: "new",
      name: "New organization",
      slug: "new",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];
  await act(async () => {
    await mocks.refetch();
  });
  expect(
    screen.getByRole("heading", { name: "Getting your space ready" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Choose your organization" }),
  ).toBeNull();
});
