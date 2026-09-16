import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
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
}));

vi.mock("@/lib/auth-client", async () => {
  const { createAuthClient } = await import("better-auth/react");
  const { organizationClient } = await import("better-auth/client/plugins");
  return {
    authClient: createAuthClient({
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
    }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/account">{children}</a>
  ),
  ErrorComponent: () => null,
  redirect: vi.fn(),
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders: vi.fn() }));
vi.mock("@/components/create-organization-dialog", () => ({
  CreateOrganizationDialog: () => null,
}));

import { authClient } from "@/lib/auth-client";
import { Route } from "./_authenticated";

function CachedOrganizationMenu() {
  const { data } = authClient.useListOrganizations();
  return <div>{data?.map((org) => org.name).join(", ")}</div>;
}

it("refreshes memberships when the chooser replaces a menu with cached organizations", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ErrorPage = Route.options.errorComponent as ComponentType<{
    error: Error;
  }>;
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
      <ErrorPage
        error={new Error("You are not a member of this organization")}
      />
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
    await screen.findByText("You don't belong to an organization"),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "You are no longer a member",
  );
  expect(
    screen.getByRole("button", { name: "Create organization" }),
  ).toBeEnabled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
