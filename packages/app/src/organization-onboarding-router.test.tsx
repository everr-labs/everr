import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRoute,
  createRouter,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/telemetry/client", () => ({}));
vi.mock("@/routes/_auth/-components/ascii-logo", () => ({
  AsciiLogo: () => <div data-testid="mascot" />,
}));
vi.mock("@/telemetry/consent-gate", () => ({
  ConsentGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@tanstack/react-devtools", () => ({ TanStackDevtools: () => null }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useListOrganizations: () => ({ data: [{ id: "only-org", name: "Acme" }] }),
    signOut: vi.fn(),
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
  getCookie: () => undefined,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: (handler: () => unknown) => handler }),
  createIsomorphicFn: () => ({
    server: () => ({ client: (handler: () => unknown) => handler }),
  }),
}));

import { useOrganizationSetupCompletion } from "@/components/use-organization-setup-completion";
import { auth } from "@/lib/auth.server";
import { Route as root } from "@/routes/__root";
import { Route as authRoute } from "@/routes/_auth";
import { Route as onboardingRoute } from "@/routes/_auth/_onboarding";

afterEach(() => vi.useRealTimers());

it("preserves the welcome mascot from signup through setup and refreshes auth on the final navigation", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

  function Signup() {
    const router = useRouter();
    return (
      <button
        type="button"
        onClick={() => void router.navigate({ to: "/organization-setup" })}
      >
        Complete signup
      </button>
    );
  }
  function Setup() {
    const [startedAt] = useState(Date.now);
    useOrganizationSetupCompletion(true, startedAt, "/");
    return <p>Provisioning</p>;
  }
  const authentication = createRoute({
    getParentRoute: () => root,
    id: "_auth",
    component: authRoute.options.component,
  });
  const onboarding = createRoute({
    getParentRoute: () => authentication,
    id: "_onboarding",
    beforeLoad: (options) =>
      onboardingRoute.options.beforeLoad?.(options as never),
  });
  const signup = createRoute({
    getParentRoute: () => authentication,
    path: "/auth/sign-up",
    component: Signup,
  });
  const setup = createRoute({
    getParentRoute: () => onboarding,
    path: "/organization-setup",
    component: Setup,
  });
  const app = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Dashboard</p>,
  });
  // This test renders the route content inside jsdom's existing document.
  Object.assign(root.options, { shellComponent: undefined });
  const router = createRouter({
    routeTree: root.addChildren([
      authentication.addChildren([signup, onboarding.addChildren([setup])]),
      app,
    ]),
    history: createMemoryHistory({ initialEntries: ["/auth/sign-up"] }),
    context: { queryClient: new QueryClient() },
  });
  Object.assign(router, { isShell: () => false });
  await act(async () => {
    await router.load();
  });
  render(<RouterProvider router={router} />);
  const mascot = screen.getByTestId("mascot");
  const headline = screen.getByText("Observability made simple");
  expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Complete signup" }));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText("Provisioning")).toBeVisible();
  expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Switch organization" }),
  ).toBeNull();
  expect(screen.getByTestId("mascot")).toBe(mascot);
  expect(screen.getByText("Observability made simple")).toBe(headline);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2499);
  });
  expect(screen.queryByText("Dashboard")).toBeNull();
  vi.mocked(auth.api.getSession).mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText("Dashboard")).toBeVisible();
  expect(auth.api.getSession).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("mascot")).toBeNull();
});
