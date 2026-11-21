import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";
import type { RootContext } from "#app/routes/__root.tsx";
import {
  ensureRouteAccess,
  refetchRouteAccess,
  revalidateRootAccess,
  rootContextKey,
  routeAccessQuery,
} from "./route-access-cache";

function rootContext(organizationId: string): RootContext {
  return {
    session: {
      user: { id: "user-1" },
      session: { id: "session-1", activeOrganizationId: organizationId },
    },
  } as RootContext;
}

function setup(cachedOrganization: string) {
  const queryClient = new QueryClient();
  const router = { invalidate: vi.fn(() => Promise.resolve()), navigate: vi.fn() };
  queryClient.setQueryData(
    routeAccessQuery(rootContextKey, () => Promise.resolve(rootContext(cachedOrganization)))
      .queryKey,
    rootContext(cachedOrganization),
  );
  queryClient.setQueryData(["logs"], ["from org-a"]);
  return { queryClient, router };
}

it("leaves the tab alone when the session and organization are unchanged", async () => {
  const { queryClient, router } = setup("org-a");

  await revalidateRootAccess(queryClient, router, () => Promise.resolve(rootContext("org-a")));

  expect(router.invalidate).not.toHaveBeenCalled();
  expect(queryClient.getQueryData(["logs"])).toEqual(["from org-a"]);
});

it("re-runs the guards and drops the old data when another tab switched organization", async () => {
  const { queryClient, router } = setup("org-a");

  await revalidateRootAccess(queryClient, router, () => Promise.resolve(rootContext("org-b")));

  expect(router.invalidate).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData(["route-access", "root"])).toBeUndefined();
  expect(queryClient.getQueryData(["logs"])).toBeUndefined();
});

it("re-runs the guards when another tab signed out", async () => {
  const { queryClient, router } = setup("org-a");

  await revalidateRootAccess(queryClient, router, () =>
    Promise.resolve({ ...rootContext("org-a"), session: null }),
  );

  expect(router.invalidate).toHaveBeenCalledOnce();
});

describe("a guard whose own read is refused", () => {
  const refused = (message: string) =>
    routeAccessQuery(["organization", "session-1", "org-a"], () =>
      Promise.reject(new Error(message)),
    );

  it("starts the page over with fresh access", async () => {
    const { queryClient } = setup("org-a");

    await expect(
      ensureRouteAccess(queryClient, refused("Unauthenticated"), "/logs?level=error"),
    ).rejects.toMatchObject({ options: { href: "/logs?level=error", replace: true } });
    expect(queryClient.getQueryData(["route-access", "root"])).toBeUndefined();
  });

  it("shows the error when the server keeps refusing", async () => {
    const { queryClient } = setup("org-a");
    await ensureRouteAccess(queryClient, refused("Unauthenticated"), "/logs").catch(() => {});

    await expect(
      ensureRouteAccess(queryClient, refused("Unauthenticated"), "/logs"),
    ).rejects.toThrow("Unauthenticated");
  });

  it("leaves other failures to the router", async () => {
    const { queryClient } = setup("org-a");

    await expect(
      ensureRouteAccess(queryClient, refused("ClickHouse unavailable"), "/logs"),
    ).rejects.toThrow("ClickHouse unavailable");
    expect(queryClient.getQueryData(["route-access", "root"])).toBeDefined();
  });
});

it("reads cached guard data from the server again", async () => {
  const queryClient = new QueryClient();
  const policy = vi
    .fn()
    .mockResolvedValueOnce({ access: "suspended" })
    .mockResolvedValueOnce({ access: "enabled" });
  await queryClient.ensureQueryData(routeAccessQuery(["policy", "org-a"], policy));

  expect(await refetchRouteAccess(queryClient, ["policy", "org-a"])).toEqual({
    access: "enabled",
  });
});
