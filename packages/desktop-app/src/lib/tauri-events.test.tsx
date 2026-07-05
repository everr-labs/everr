import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as TauriModule from "./tauri";
import { safeGetCurrentWindow } from "./tauri";
import { useTauriEvent } from "./tauri-events";

vi.mock("./tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return {
    ...actual,
    safeGetCurrentWindow: vi.fn(),
  };
});

function deferred<T>() {
  let resolveFn!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });

  return { promise, resolve: resolveFn };
}

describe("useTauriEvent", () => {
  const windowMock = {
    listen: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(safeGetCurrentWindow).mockReturnValue(windowMock as never);
  });

  it("unlistens when listener setup resolves after unmount", async () => {
    const setup = deferred<() => void>();
    const unlisten = vi.fn();
    windowMock.listen.mockReturnValue(setup.promise);

    const { unmount } = renderHook(() => useTauriEvent("event-name", vi.fn()));

    unmount();

    await act(async () => {
      setup.resolve(unlisten);
      await setup.promise;
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("handles rejected unlisten promises during cleanup", async () => {
    const unlisten = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("listener already removed"));
    windowMock.listen.mockResolvedValue(unlisten);

    const { unmount } = renderHook(() => useTauriEvent("event-name", vi.fn()));

    await act(async () => {
      await windowMock.listen.mock.results[0]?.value;
    });

    unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
