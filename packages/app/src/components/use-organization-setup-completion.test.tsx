import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ invalidate: vi.fn(), navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));

import { useOrganizationSetupCompletion } from "./use-organization-setup-completion";

function Probe({ ready }: { ready: boolean }) {
  useOrganizationSetupCompletion(ready, 10_000, "/logs?service=api");
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());
function show(ready: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe ready={ready} />
    </QueryClientProvider>,
  );
}
it("keeps a fast completion on screen for at least 2.5 seconds", async () => {
  show(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2499);
  });
  expect(router.navigate).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(router.navigate).toHaveBeenCalledOnce();
  expect(router.navigate).toHaveBeenCalledWith({
    href: "/logs?service=api",
    replace: true,
  });
});
it("never continues just because the minimum duration has elapsed", async () => {
  const view = show(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(router.navigate).not.toHaveBeenCalled();
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <Probe ready />
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(router.navigate).toHaveBeenCalledOnce();
});
it("cancels continuation if readiness is lost before the minimum duration", async () => {
  const view = show(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <Probe ready={false} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(router.navigate).not.toHaveBeenCalled();
});
