// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCookie: vi.fn(),
  headers: new Headers(),
}));

vi.mock("@/telemetry/client", () => ({}));
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

import { Route } from "./__root";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TSS_PRERENDERING", "false");
});

afterEach(() => vi.unstubAllEnvs());

async function loadContext() {
  return (Route.options.beforeLoad as () => unknown)();
}

it("resolves the session and consent for live requests before auth guards run", async () => {
  const session = { user: { id: "user-1" }, session: { id: "session-1" } };
  mocks.getSession.mockResolvedValue(session);
  mocks.getCookie.mockReturnValue("granted");

  expect(await loadContext()).toEqual({ session, consent: "granted" });
  expect(mocks.getSession).toHaveBeenCalledWith({ headers: mocks.headers });
});

it("keeps signed-out live requests signed out", async () => {
  mocks.getSession.mockResolvedValue(null);
  mocks.getCookie.mockReturnValue(undefined);

  expect(await loadContext()).toEqual({
    session: null,
    consent: undefined,
  });
  expect(mocks.getSession).toHaveBeenCalledOnce();
});

it("generates the prerendered shell without looking up runtime session data", async () => {
  vi.stubEnv("TSS_PRERENDERING", "true");

  expect(await loadContext()).toEqual({ session: null, consent: undefined });
  expect(mocks.getSession).not.toHaveBeenCalled();
  expect(mocks.getCookie).not.toHaveBeenCalled();
});
