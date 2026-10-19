// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
vi.mock("#app/lib/auth.server.ts", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => mocks.headers,
  getCookie: mocks.getCookie,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: () => unknown) => fn }),
  }),
  createIsomorphicFn: () => ({
    server: (fn: () => unknown) => ({ client: () => fn }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TSS_PRERENDERING", "false");
});

afterEach(() => vi.unstubAllEnvs());

async function loadContext(pathname = "/") {
  return (Route.options.beforeLoad as (options: unknown) => unknown)({
    location: { pathname },
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

it.each([
  { href: "/setup" },
  { to: "/" },
])("applies the application's redirect %j with history replacement", async (entryRedirect) => {
  mocks.getEntryRedirect.mockResolvedValueOnce(entryRedirect);
  await expect(loadContext("/some-path")).rejects.toMatchObject({
    options: { ...entryRedirect, replace: true },
  });
  expect(mocks.getEntryRedirect).toHaveBeenCalledWith("/some-path");
});
