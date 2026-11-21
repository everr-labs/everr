import { MutationObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createQueryClient } from "./query-client";
import { routeAccessQuery } from "./route-access-cache";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const router = {
    invalidate: vi.fn(() => Promise.resolve()),
    navigate: vi.fn(() => Promise.resolve()),
  };
  const queryClient = createQueryClient(() => router);
  const guard = routeAccessQuery(["root"], () => Promise.resolve({ session: "cached" }));
  queryClient.setQueryData(guard.queryKey, { session: "cached" });
  const guardData = () => queryClient.getQueryData(guard.queryKey);
  const guardsRerun = (times: number) =>
    vi.waitFor(() => expect(router.invalidate).toHaveBeenCalledTimes(times));
  return { router, queryClient, guardData, guardsRerun };
}

it("re-runs the guards with fresh data once when data requests find the session gone", async () => {
  const { queryClient, guardData, guardsRerun } = setup();
  const queryFn = vi.fn(() => Promise.reject(new Error("Unauthenticated")));

  await Promise.allSettled([
    queryClient.fetchQuery({ queryKey: ["metrics"], queryFn }),
    queryClient.fetchQuery({ queryKey: ["logs"], queryFn }),
  ]);

  expect(queryFn).toHaveBeenCalledTimes(2);
  await guardsRerun(1);
  expect(guardData()).toBeUndefined();
});

it.each([
  "No active organization",
  "Not a member of the active organization",
  "Organization suspended",
  "Not authorized",
  "Active organization changed",
])("re-runs the guards when a change fails with %s", async (message) => {
  const { queryClient, guardData, guardsRerun } = setup();

  await new MutationObserver(queryClient, {
    mutationFn: () => Promise.reject(new Error(message)),
  })
    .mutate()
    .catch(() => {});

  await guardsRerun(1);
  expect(guardData()).toBeUndefined();
});

it("drops the previous organization's cached pages when the session moved to another", async () => {
  const { queryClient, guardsRerun } = setup();
  queryClient.setQueryData(["dashboards"], ["from the previous organization"]);

  await queryClient
    .fetchQuery({
      queryKey: ["logs"],
      queryFn: () => Promise.reject(new Error("Active organization changed")),
    })
    .catch(() => {});

  await guardsRerun(1);
  expect(queryClient.getQueryData(["dashboards"])).toBeUndefined();
});

it("stops re-running the guards for a page that keeps failing after they let it through", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { queryClient, guardsRerun } = setup();
  const fail = () =>
    queryClient
      .fetchQuery({
        queryKey: ["api-keys"],
        queryFn: () => Promise.reject(new Error("Not authorized")),
        staleTime: 0,
      })
      .catch(() => {});

  await fail();
  await guardsRerun(1);
  await fail();
  await guardsRerun(1);

  vi.advanceTimersByTime(10_000);
  await fail();
  await guardsRerun(2);
});

it("leaves other failures to the page", async () => {
  const { router, queryClient, guardData } = setup();

  await queryClient
    .fetchQuery({
      queryKey: ["metrics"],
      queryFn: () => Promise.reject(new Error("ClickHouse unavailable")),
      retry: false,
    })
    .catch(() => {});

  expect(router.invalidate).not.toHaveBeenCalled();
  expect(guardData()).toEqual({ session: "cached" });
});
