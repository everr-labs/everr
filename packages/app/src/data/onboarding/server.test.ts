import { beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ getStatus: vi.fn(), complete: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("./store", () => ({ createOnboardingStore: () => store }));

import { completeOnboarding, getHomeStatus } from "./server";

beforeEach(() => vi.clearAllMocks());
it("derives identity and the active organization from the authenticated session", async () => {
  await getHomeStatus({ data: { organizationId: "test_org" } });
  await completeOnboarding({ data: { organizationId: "test_org" } });
  const scope = { organizationId: "test_org", userId: "test_user" };
  expect(store.getStatus).toHaveBeenCalledWith(scope);
  expect(store.complete).toHaveBeenCalledWith(scope);
});
it("rejects stale organization requests for reads and completion", async () => {
  await expect(
    getHomeStatus({ data: { organizationId: "previous_org" } }),
  ).rejects.toThrow("Organization changed");
  await expect(
    completeOnboarding({ data: { organizationId: "previous_org" } }),
  ).rejects.toThrow("Organization changed");
  expect(store.getStatus).not.toHaveBeenCalled();
  expect(store.complete).not.toHaveBeenCalled();
});
it("rejects injected identity, secrets and flag values", async () => {
  const data = { organizationId: "test_org" };
  for (const extra of [
    { userId: "another_user" },
    { key: "secret" },
    { onboardingCompleted: false },
  ]) {
    await expect(
      completeOnboarding({ data: { ...data, ...extra } as typeof data }),
    ).rejects.toThrow();
  }
  expect(store.complete).not.toHaveBeenCalled();
});
