import { describe, expect, it, vi } from "vitest";
import { getGitHubEventsConfig } from "./config";

vi.mock("@/db/client", () => ({
  pool: {},
}));

import { PostgresWebhookEventStore } from "./queue-store";

function createStore(query = vi.fn().mockResolvedValue({ rowCount: 1 })) {
  const db = {
    query,
  };

  const store = new PostgresWebhookEventStore(db as never, {
    ...getGitHubEventsConfig(),
    lockDurationMs: 45_000,
  });

  return { store, query };
}

describe("PostgresWebhookEventStore", () => {
  it("fences done finalization to the active processing claim", async () => {
    const { store, query } = createStore();

    const finalized = await store.finalizeEvent({
      eventId: 7,
      attempts: 2,
      result: "done",
    });

    expect(finalized).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("SET status = 'done'");
    expect(query.mock.calls[0]?.[0]).toContain("AND attempts = $2");
    expect(query.mock.calls[0]?.[0]).toContain("AND status = 'processing'");
    expect(query.mock.calls[0]?.[1]).toEqual([7, 2]);
  });

  it("returns false when a stale worker tries to finalize an event", async () => {
    const { store } = createStore(vi.fn().mockResolvedValue({ rowCount: 0 }));

    const finalized = await store.finalizeEvent({
      eventId: 7,
      attempts: 2,
      result: "failed",
      errorClass: "retryable",
      lastError: "boom",
    });

    expect(finalized).toBe(false);
  });

  it("renews the lock for the claimed attempt only", async () => {
    const { store, query } = createStore();

    const renewed = await store.renewEventLock({
      eventId: 19,
      attempts: 4,
    });

    expect(renewed).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("SET locked_until = now()");
    expect(query.mock.calls[0]?.[0]).toContain("AND attempts = $2");
    expect(query.mock.calls[0]?.[0]).toContain("AND status = 'processing'");
    expect(query.mock.calls[0]?.[1]).toEqual([19, 4, 45_000]);
  });
});
