import { DropdownMenuItem } from "@everr/ui/components/dropdown-menu";
import { SidebarProvider } from "@everr/ui/components/sidebar";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouteContext: () => ({ githubEnabled: false }),
}));
vi.mock("#app/lib/auth-client.ts", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: { id: "user", name: "Test User", email: "user@example.test" },
      },
    }),
    useActiveOrganization: () => ({
      data: {
        name: "Workspace",
        members: [{ userId: "user", role: state.role }],
      },
    }),
  },
}));
vi.mock("#app/telemetry/consent-gate.tsx", () => ({
  useOpenConsentSettings: () => vi.fn(),
}));

import { UserMenu } from "./nav-user";

beforeEach(() => {
  state.role = "owner";
});

it.each([
  "owner",
  "member",
])("renders actions in their allowed menu sections for %s", async (role) => {
  state.role = role;
  const user = userEvent.setup();
  render(
    <SidebarProvider>
      <UserMenu
        beforeOrganization={<DropdownMenuItem>General action</DropdownMenuItem>}
        organizationItems={<DropdownMenuItem>Admin action</DropdownMenuItem>}
      />
    </SidebarProvider>,
  );
  await user.click(screen.getByRole("button", { name: /Test User/ }));
  expect(
    await screen.findByRole("menuitem", { name: "General action" }),
  ).toBeVisible();
  if (role === "owner") {
    expect(
      screen.getByRole("menuitem", { name: "Admin action" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Members" })).toBeVisible();
  } else {
    expect(
      screen.queryByRole("menuitem", { name: "Admin action" }),
    ).not.toBeInTheDocument();
  }
  expect(
    screen.getByRole("menuitem", { name: "Account settings" }),
  ).toBeVisible();
});
