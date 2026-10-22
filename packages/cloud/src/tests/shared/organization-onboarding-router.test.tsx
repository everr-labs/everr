// Supply server configuration while rendering the real root route in jsdom.
vi.mock("@everr/app/env", () => ({
  env: {
    NODE_ENV: "test",
    EMAIL_DSN: undefined,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
  },
}));
vi.mock("../../organization-provisioning/actions", () => ({
  completeOrganizationSetup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@everr/app/data/organization-access", () => ({
  getActiveOrganizationAccess: vi.fn().mockResolvedValue({
    status: "available",
    organization: { id: "only-org" },
  }),
}));

import { QueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  createMemoryHistory,
  createRouter,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, expect, it, vi } from "vitest";

// Exercise the real root without enabling the development telemetry exporter.
vi.stubEnv("DEV", false);
afterAll(() => vi.unstubAllEnvs());
// jsdom has no canvas renderer; keep the real welcome layout mounted.
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
vi.mock("@tanstack/react-devtools", () => ({ TanStackDevtools: () => null }));
vi.mock("@everr/app/identity/client", () => ({
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
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const chain = {
      inputValidator: (validator: (value: unknown) => unknown) => {
        validate = validator;
        return chain;
      },
      handler:
        (handler: (args: { data: unknown }) => unknown) =>
        async (options: { data: unknown }) =>
          handler({ data: validate(options.data) }),
    };
    return chain;
  },
  createIsomorphicFn: () => ({
    server: (_handler: (...args: never[]) => unknown) => ({
      client: (handler: (...args: never[]) => unknown) => handler,
    }),
  }),
}));

import { auth } from "@everr/app/identity/server";
import {
  productRouteFiles,
  sharedRouteModules,
} from "@everr/app/testing/routes";
import { useOrganizationSetupCompletion } from "../../components/use-organization-setup-completion";

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
  useOrganizationSetupCompletion(true, startedAt, "/", "only-org");
  return <p>Provisioning</p>;
}
const sourceModule = (path: string) => new URL(path, import.meta.url).pathname;
const setupModule = sourceModule(
  "../../routes/_welcome/_signedIn/_organization/organization-setup.tsx",
);
const retained = new Set([
  sharedRouteModules.root,
  sharedRouteModules.welcome,
  sharedRouteModules.guest,
  sharedRouteModules.signedIn,
  sourceModule("../../routes/_welcome/_signedIn/_organization.tsx"),
]);
for (const path of [
  ...productRouteFiles,
  ...Object.keys(import.meta.glob("../../routes/**/*.{ts,tsx}")).map(
    sourceModule,
  ),
]) {
  if (retained.has(path)) continue;
  vi.doMock(path, () => ({
    Route: createFileRoute()({
      component:
        path === sharedRouteModules.signup
          ? Signup
          : path === setupModule
            ? Setup
            : path === sharedRouteModules.home
              ? () => <p>Dashboard</p>
              : undefined,
    }),
  }));
}
const { routeTree } = await import("@composition/routes");
// Render route content inside jsdom's existing document.
Object.assign(routeTree.options, { shellComponent: undefined });

afterEach(() => vi.useRealTimers());

it("preserves the welcome mascot from signup through setup and refreshes auth on the final navigation", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/auth/sign-up"] }),
    context: { queryClient: new QueryClient() },
  });
  Object.assign(router, { isShell: () => false });
  await act(async () => {
    await router.load();
  });
  render(<RouterProvider router={router} />);
  const mascot = document.querySelector("canvas");
  expect(mascot).not.toBeNull();
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
  expect(document.querySelector("canvas")).toBe(mascot);
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
  expect(document.querySelector("canvas")).toBeNull();
});
