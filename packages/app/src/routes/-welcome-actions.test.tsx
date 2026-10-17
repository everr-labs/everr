import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@composition/ui", () => ({
  productUI: {
    welcomeActions: [
      {
        id: "workspace",
        component: ({
          activeOrganizationId,
        }: {
          activeOrganizationId: string;
        }) => <button type="button">Workspace {activeOrganizationId}</button>,
      },
    ],
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({
      session: state.signedIn
        ? { user: { id: "user" }, session: { activeOrganizationId: "org" } }
        : null,
    }),
  }),
  Outlet: () => <div>Page content</div>,
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("./_welcome/-components/ascii-logo", () => ({ AsciiLogo: () => null }));

import { Route } from "./-_welcome";

const Welcome = Route.options.component as ComponentType;

it.each([
  true,
  false,
])("renders welcome contributions only for signed-in users (%s)", (signedIn) => {
  state.signedIn = signedIn;
  render(<Welcome />);
  expect(screen.getByText("Page content")).toBeVisible();
  if (signedIn) {
    expect(screen.getByRole("button", { name: "Workspace org" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
  } else {
    expect(
      screen.queryByRole("button", { name: "Workspace org" }),
    ).not.toBeInTheDocument();
  }
});
