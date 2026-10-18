import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@composition/layouts", async () => {
  const { WelcomeLayout } = await import(
    "#app/components/welcome/welcome-layout.tsx"
  );
  return {
    layouts: {
      Welcome: ({
        activeOrganizationId,
        ...props
      }: import("#app/product/layouts.tsx").WelcomeProps) => (
        <WelcomeLayout
          {...props}
          actions={
            <button type="button">Workspace {activeOrganizationId}</button>
          }
        />
      ),
    },
  };
});
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
vi.mock("#app/lib/auth-client.ts", () => ({
  authClient: { signOut: vi.fn() },
}));
vi.mock("#app/components/welcome/ascii-logo.tsx", () => ({
  AsciiLogo: () => null,
}));

import { Route } from "./-_welcome";

const Welcome = Route.options.component as ComponentType;

it.each([
  true,
  false,
])("renders welcome actions only for signed-in users (%s)", (signedIn) => {
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
