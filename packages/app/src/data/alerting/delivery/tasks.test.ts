import { describe, expect, it, vi } from "vitest";

// The tasks module reaches the worker enqueue plumbing; the mock only keeps
// the import from reaching the real database client.
vi.mock("@/db/client", () => ({ db: {}, pool: {} }));

import { flushGroupJobKey } from "./tasks";

describe("flushGroupJobKey", () => {
  it("keys on the group and its due time only, not the triggering event", () => {
    const flushAt = new Date("2026-08-10T10:00:30.000Z");

    // Two different events dispatching to the same group at the same
    // nextFlushAt must build the identical key, or a storm of events fans
    // out into one flush job per event instead of collapsing onto one.
    expect(flushGroupJobKey("group-1", flushAt)).toBe(
      flushGroupJobKey("group-1", flushAt),
    );
    expect(flushGroupJobKey("group-1", flushAt)).toBe(
      "alerts/flush-group:group-1:2026-08-10T10:00:30.000Z",
    );
  });

  it("differs across groups and across due times", () => {
    const flushAt = new Date("2026-08-10T10:00:30.000Z");
    const later = new Date("2026-08-10T10:05:00.000Z");

    expect(flushGroupJobKey("group-1", flushAt)).not.toBe(
      flushGroupJobKey("group-2", flushAt),
    );
    expect(flushGroupJobKey("group-1", flushAt)).not.toBe(
      flushGroupJobKey("group-1", later),
    );
  });
});
