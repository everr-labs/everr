import { MutationObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vite-plus/test";
import { createQueryClient } from "./query-client";
import { routeAccessQuery } from "./route-access-cache";

function setup() {
  const router = { invalidate: vi.fn(() => Promise.resolve()) };
  const queryClient = createQueryClient(() => router);
  const guard = routeAccessQuery(["root"], () => Promise.resolve({ session: "cached" }));
  queryClient.setQueryData(guard.queryKey, { session: "cached" });
  const guardData = () => queryClient.getQueryData(guard.queryKey);
  return { router, queryClient, guardData };
}

it("re-runs the guards with fresh data once when data requests find the session gone", async () => {
  const { router, queryClient, guardData } = setup();
  const queryFn = vi.fn(() => Promise.reject(new Error("Unauthenticated")));

  await Promise.allSettled([
    queryClient.fetchQuery({ queryKey: ["metrics"], queryFn }),
    queryClient.fetchQuery({ queryKey: ["logs"], queryFn }),
  ]);

  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(router.invalidate).toHaveBeenCalledOnce();
  expect(guardData()).toBeUndefined();
});

it.each([
  "No active organization",
  "Not a member of the active organization",
  "Organization suspended",
])("re-runs the guards when a change fails with %s", async (message) => {
  const { router, queryClient, guardData } = setup();

  await new MutationObserver(queryClient, {
    mutationFn: () => Promise.reject(new Error(message)),
  })
    .mutate()
    .catch(() => {});

  expect(router.invalidate).toHaveBeenCalledOnce();
  expect(guardData()).toBeUndefined();
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
