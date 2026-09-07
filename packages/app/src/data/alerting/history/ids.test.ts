import { describe, expect, it } from "vitest";
import { deterministicDeliveryEventId, uuidv7, uuidv7Time } from "./ids";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("encodes the creation time recoverably", () => {
    const at = new Date("2026-08-09T12:34:56.789Z");
    const id = uuidv7(at);
    expect(id).toMatch(UUID_RE);
    expect(uuidv7Time(id).toISOString()).toBe(at.toISOString());
  });

  it("stamps version 7 and the RFC variant", () => {
    const id = uuidv7();
    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("mints distinct ids for the same millisecond", () => {
    const at = new Date();
    expect(uuidv7(at)).not.toBe(uuidv7(at));
  });
});

describe("deterministicDeliveryEventId", () => {
  const base = {
    notificationEventId: "0198c0de-0000-7000-8000-000000000001",
    dedupKey: "group-1:slack:ops",
  } as const;

  it("is stable across retries for a success", () => {
    const a = deterministicDeliveryEventId({ ...base, outcome: "succeeded" });
    const b = deterministicDeliveryEventId({ ...base, outcome: "succeeded" });
    expect(a).toBe(b);
    expect(a).toMatch(UUID_RE);
  });

  it("separates outcomes and delivery keys", () => {
    const succeeded = deterministicDeliveryEventId({
      ...base,
      outcome: "succeeded",
    });
    const failed = deterministicDeliveryEventId({
      ...base,
      outcome: "failed",
      attemptAt: new Date("2026-08-09T00:00:00Z"),
    });
    const otherKey = deterministicDeliveryEventId({
      ...base,
      dedupKey: "group-2:slack:ops",
      outcome: "succeeded",
    });
    expect(new Set([succeeded, failed, otherKey]).size).toBe(3);
  });

  it("keeps one row per failed attempt", () => {
    const first = deterministicDeliveryEventId({
      ...base,
      outcome: "failed",
      attemptAt: new Date("2026-08-09T00:00:00Z"),
    });
    const second = deterministicDeliveryEventId({
      ...base,
      outcome: "failed",
      attemptAt: new Date("2026-08-09T00:05:00Z"),
    });
    expect(first).not.toBe(second);
  });
});
