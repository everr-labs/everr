import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { dehydrateRootAccess, hydrateRootAccess } from "#app/lib/route-access-cache.ts";
import { Route } from "./__root";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getEntryRedirect: vi.fn(),
  getCookie: vi.fn(),
  headers: new Headers(),
}));
vi.mock("@composition/entry", () => ({
  entry: {
    getEntryRedirect: mocks.getEntryRedirect,
  },
}));
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
    server: (fn: () => unknown) => ({ client: () => fn }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TSS_PRERENDERING", "false");
});

afterEach(() => vi.unstubAllEnvs());

async function loadContext(pathname = "/", queryClient = new QueryClient()) {
  return (Route.options.beforeLoad as (options: unknown) => unknown)({
    location: { pathname },
    context: { queryClient },
  });
}

it("resolves the session and consent for live requests before auth guards run", async () => {
  const session = { user: { id: "user-1" }, session: { id: "session-1" } };
  mocks.getSession.mockResolvedValue(session);
  mocks.getCookie.mockReturnValue("granted");

  expect(await loadContext()).toEqual({
    session,
    consent: "granted",
    emailEnabled: true,
    googleSignInEnabled: true,
    githubEnabled: true,
  });
  expect(mocks.getSession).toHaveBeenCalledWith({ headers: mocks.headers });
});

it("keeps signed-out live requests signed out", async () => {
  mocks.getSession.mockResolvedValue(null);
  mocks.getCookie.mockReturnValue(undefined);

  expect(await loadContext()).toEqual({
    emailEnabled: true,
    googleSignInEnabled: true,
    githubEnabled: true,
    session: null,
    consent: undefined,
  });
  expect(mocks.getSession).toHaveBeenCalledOnce();
});

it("generates the prerendered shell without looking up runtime session data", async () => {
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
  expect(mocks.getEntryRedirect).not.toHaveBeenCalled();
});

it.each([{ href: "/setup" }, { to: "/" }])(
  "applies the application's redirect %j with history replacement",
  async (entryRedirect) => {
    mocks.getEntryRedirect.mockResolvedValueOnce(entryRedirect);
    await expect(loadContext("/some-path")).rejects.toMatchObject({
      options: { ...entryRedirect, replace: true },
    });
    expect(mocks.getEntryRedirect).toHaveBeenCalledWith("/some-path");
  },
);

it("reuses the session across navigations and asks for the entry redirect once per path", async () => {
  const queryClient = new QueryClient();
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" }, session: { id: "session-1" } });

  await loadContext("/metrics", queryClient);
  await loadContext("/metrics", queryClient);
  await loadContext("/logs", queryClient);

  expect(mocks.getSession).toHaveBeenCalledOnce();
  expect(mocks.getEntryRedirect.mock.calls).toEqual([["/metrics"], ["/logs"]]);
});

it("keeps redirecting a path whose entry redirect was already read", async () => {
  const queryClient = new QueryClient();
  mocks.getEntryRedirect.mockResolvedValueOnce({ to: "/" });

  await expect(loadContext("/setup", queryClient)).rejects.toMatchObject({
    options: { to: "/" },
  });
  await expect(loadContext("/setup", queryClient)).rejects.toMatchObject({
    options: { to: "/" },
  });
  expect(mocks.getEntryRedirect).toHaveBeenCalledOnce();
});

it("hands the page load's session to the browser so its first navigation does not ask again", async () => {
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" }, session: { id: "session-1" } });
  const server = new QueryClient();
  await loadContext("/metrics", server);

  const browser = new QueryClient();
  hydrateRootAccess(browser, dehydrateRootAccess(server, "/metrics"));
  await loadContext("/metrics", browser);

  expect(mocks.getSession).toHaveBeenCalledOnce();
  expect(mocks.getEntryRedirect).toHaveBeenCalledOnce();
});
