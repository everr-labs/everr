// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Route } from "./__root";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCookie: vi.fn(),
  headers: new Headers(),
}));
vi.mock("@composition/server", () => ({
  server: {
    getAppEntry: async () => ({ setupRequired: false }),
  },
}));
vi.mock("@/telemetry/client", () => ({}));
vi.mock("@/lib/auth-providers.server", () => ({
  socialProviders: { google: {} },
}));
vi.mock("@/integrations/github/configuration", () => ({
  getGithubConfiguration: () => ({}),
}));
vi.mock("@/lib/auth.server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => mocks.headers,
  getCookie: mocks.getCookie,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: (fn: () => unknown) => fn }),
  createIsomorphicFn: () => ({
    server: (fn: () => unknown) => ({ client: () => fn }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TSS_PRERENDERING", "false");
});

afterEach(() => vi.unstubAllEnvs());

async function loadContext() {
  return (Route.options.beforeLoad as (options: unknown) => unknown)({
    location: { pathname: "/" },
  });
}

it("resolves the session and consent for live requests before auth guards run", async () => {
  const session = { user: { id: "user-1" }, session: { id: "session-1" } };
  mocks.getSession.mockResolvedValue(session);
  mocks.getCookie.mockReturnValue("granted");

  expect(await loadContext()).toEqual({
    session,
    consent: "granted",
    createdOrganizationId: null,
    setupRequired: false,
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
    createdOrganizationId: null,
    setupRequired: false,
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
    createdOrganizationId: null,
    setupRequired: false,
    emailEnabled: false,
    googleSignInEnabled: false,
    githubEnabled: false,
  });
  expect(mocks.getSession).not.toHaveBeenCalled();
  expect(mocks.getCookie).not.toHaveBeenCalled();
});
