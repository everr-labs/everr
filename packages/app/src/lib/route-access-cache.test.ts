import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vite-plus/test";
import type { RootContext } from "#app/routes/__root.tsx";
import { hydrateRootContext, revalidateRootAccess } from "./route-access-cache";

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
  hydrateRootContext(queryClient, rootContext(cachedOrganization));
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
