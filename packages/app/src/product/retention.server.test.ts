import { afterEach, describe, expect, it, vi } from "vitest";
import { retentionForDays } from "./retention.test-fixtures";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("@app/policy", () => ({
  productPolicy: { forOrganization: lookup },
}));

import { retentionForOrg } from "./retention.server";

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
    await expect(retentionForOrg("retry")).resolves.toEqual(
      retentionForDays(14),
    );
  });
  it("refreshes policy after the cache expires", async () => {
    vi.useFakeTimers();
    lookup.mockResolvedValueOnce({ retention: retentionForDays(14) });
    await retentionForOrg("expires");
    vi.advanceTimersByTime(30_001);
    lookup.mockResolvedValueOnce({ retention: retentionForDays(90) });
    await expect(retentionForOrg("expires")).resolves.toEqual(
      retentionForDays(90),
    );
  });
});
