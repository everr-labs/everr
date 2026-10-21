import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createProduct } from "./module";
import { retentionForDays } from "./retention.test-fixtures";

const lookup = vi.fn();
const { retentionForOrg } = createProduct({ forOrganization: lookup });

afterEach(() => {
  vi.useRealTimers();
  lookup.mockReset();
});

describe("organization retention", () => {
  it("shares in-flight lookups per organization", async () => {
    lookup.mockResolvedValue({ retention: retentionForDays(30) });
    const first = retentionForOrg("cached");
    const second = retentionForOrg("cached");
    expect(first).toBe(second);
    await first;
    expect(lookup).toHaveBeenCalledTimes(1);
    await retentionForOrg("another");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("evicts failures so a subsequent request can recover", async () => {
    lookup.mockRejectedValueOnce(new Error("unavailable"));
    await expect(retentionForOrg("retry")).rejects.toThrow("unavailable");
    lookup.mockResolvedValueOnce({ retention: retentionForDays(14) });
    await expect(retentionForOrg("retry")).resolves.toEqual(retentionForDays(14));
  });
  it("refreshes policy after the cache expires", async () => {
    vi.useFakeTimers();
    lookup.mockResolvedValueOnce({ retention: retentionForDays(14) });
    await retentionForOrg("expires");
    vi.advanceTimersByTime(30_001);
    lookup.mockResolvedValueOnce({ retention: retentionForDays(90) });
    await expect(retentionForOrg("expires")).resolves.toEqual(retentionForDays(90));
  });
});

it("does not share policy or cached retention across compositions", async () => {
  const installation = createProduct({
    forOrganization: async () => ({
      access: "enabled",
      canInviteMembers: true,
      retention: retentionForDays(30),
    }),
  });
  const restricted = createProduct({
    forOrganization: async () => ({
      access: "enabled",
      canInviteMembers: false,
      retention: retentionForDays(7),
    }),
  });
  expect(await installation.retentionForOrg("same-id")).toEqual(retentionForDays(30));
  expect(await restricted.retentionForOrg("same-id")).toEqual(retentionForDays(7));
  expect(await installation.canInviteMembers("same-id")).toBe(true);
  expect(await restricted.canInviteMembers("same-id")).toBe(false);
});
