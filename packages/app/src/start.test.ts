// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createStart: vi.fn(() => ({
    getOptions: vi.fn(),
  })),
}));

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  authkitMiddleware: vi.fn(() => ({})),
}));

type RuntimeModuleMock = {
  ensureGitHubEventsRuntimeForAppStart: ReturnType<typeof vi.fn>;
};

async function loadStartWithRuntimeMock(runtimeMock: RuntimeModuleMock) {
  vi.doMock("./server/github-events/runtime", () => runtimeMock);
  return import("./start");
}

describe("ensureAppRuntimeStarted", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("skips runtime startup in tests", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const runtimeMock = {
      ensureGitHubEventsRuntimeForAppStart: vi.fn(),
    };
    const { ensureAppRuntimeStarted } =
      await loadStartWithRuntimeMock(runtimeMock);

    await ensureAppRuntimeStarted();

    expect(
      runtimeMock.ensureGitHubEventsRuntimeForAppStart,
    ).not.toHaveBeenCalled();
  });

  it("delegates runtime startup on the server", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const runtimeMock = {
      ensureGitHubEventsRuntimeForAppStart: vi
        .fn()
        .mockResolvedValue(undefined),
    };
    const { ensureAppRuntimeStarted } =
      await loadStartWithRuntimeMock(runtimeMock);

    await ensureAppRuntimeStarted();

    expect(
      runtimeMock.ensureGitHubEventsRuntimeForAppStart,
    ).toHaveBeenCalledTimes(1);
  });
});
