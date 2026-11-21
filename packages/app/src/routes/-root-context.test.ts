import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { Route } from "./__root";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  entry: { getEntryState: vi.fn() as ((...args: unknown[]) => unknown) | undefined },
  productClient: { getEntryRedirect: vi.fn() as ((...args: unknown[]) => unknown) | undefined },
  getCookie: vi.fn(),
  headers: new Headers(),
  // Production renders no route on the server: only page-shell prerendering
  // and the dev server take the server branch.
  side: "client" as "server" | "client",
}));
vi.mock("@composition/entry", () => ({ entry: mocks.entry }));
vi.mock("@composition/client", () => ({ productClient: mocks.productClient }));
vi.mock("#app/telemetry/client.ts", () => ({}));
vi.mock("#app/lib/auth-providers.server.ts", () => ({
  socialProviders: { google: {} },
}));
vi.mock("#app/integrations/github/configuration.ts", () => ({
  getGithubConfiguration: () => ({}),
}));
vi.mock("#app/identity/server.ts", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => mocks.headers,
  getCookie: mocks.getCookie,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const handler = (fn: (options: unknown) => unknown) => fn;
    return { handler, validator: () => ({ handler }) };
  },
  createIsomorphicFn: () => ({
    server: (server: (options: unknown) => unknown) => ({
      client: (client: (options: unknown) => unknown) => (options: unknown) =>
        (mocks.side === "server" ? server : client)(options),
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.side = "client";
  mocks.entry.getEntryState = vi.fn(() => Promise.resolve({ setupRequired: false }));
  mocks.productClient.getEntryRedirect = vi.fn();
  vi.stubEnv("TSS_PRERENDERING", "false");
});

afterEach(() => vi.unstubAllEnvs());

async function loadContext(pathname = "/", queryClient = new QueryClient()) {
  return (Route.options.beforeLoad as (options: unknown) => unknown)({
    location: { pathname },
    context: { queryClient },
  });
}

it("resolves the session, consent and entry state before auth guards run", async () => {
  const session = { user: { id: "user-1" }, session: { id: "session-1" } };
  mocks.getSession.mockResolvedValue(session);
  mocks.getCookie.mockReturnValue("granted");

  expect(await loadContext()).toEqual({
    session,
    consent: "granted",
    emailEnabled: true,
    googleSignInEnabled: true,
    githubEnabled: true,
    entryState: { setupRequired: false },
  });
  expect(mocks.getSession).toHaveBeenCalledWith({ headers: mocks.headers });
});

it("keeps signed-out requests signed out", async () => {
  mocks.getSession.mockResolvedValue(null);
  mocks.getCookie.mockReturnValue(undefined);

  expect(await loadContext()).toMatchObject({ session: null, consent: undefined });
  expect(mocks.getSession).toHaveBeenCalledOnce();
});

it("generates the prerendered shell without looking up runtime data", async () => {
  mocks.side = "server";
  vi.stubEnv("TSS_PRERENDERING", "true");

  expect(await loadContext()).toEqual({
    session: null,
    consent: undefined,
    emailEnabled: false,
    googleSignInEnabled: false,
    githubEnabled: false,
  });
  expect(mocks.getSession).not.toHaveBeenCalled();
  expect(mocks.getCookie).not.toHaveBeenCalled();
  expect(mocks.entry.getEntryState).not.toHaveBeenCalled();
});

it.each([{ href: "/setup" }, { to: "/" }])(
  "applies the application's redirect %j with history replacement",
  async (entryRedirect) => {
    mocks.productClient.getEntryRedirect = vi.fn(() => entryRedirect);
    await expect(loadContext("/some-path")).rejects.toMatchObject({
      options: { ...entryRedirect, replace: true },
    });
    expect(mocks.productClient.getEntryRedirect).toHaveBeenCalledWith(
      { setupRequired: false },
      "/some-path",
    );
  },
);

it("decides the entry redirect on every navigation from state read once", async () => {
  const queryClient = new QueryClient();
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" }, session: { id: "session-1" } });
  mocks.productClient.getEntryRedirect = vi.fn((_state, pathname) =>
    pathname === "/setup" ? { to: "/" } : undefined,
  );

  await loadContext("/metrics", queryClient);
  await loadContext("/logs", queryClient);
  await expect(loadContext("/setup", queryClient)).rejects.toMatchObject({
    options: { to: "/" },
  });

  expect(mocks.getSession).toHaveBeenCalledOnce();
  expect(mocks.entry.getEntryState).toHaveBeenCalledOnce();
});

it("never redirects in applications without entry decisions", async () => {
  mocks.entry.getEntryState = undefined;
  mocks.productClient.getEntryRedirect = undefined;

  expect(await loadContext("/setup")).toMatchObject({ entryState: undefined });
});
