import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.INGRESS_SOURCE = "github";
  process.env.INGRESS_COLLECTOR_URL = "http://localhost:8080/webhook/github";
});

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

function createTransactionalStore(query = vi.fn()) {
  const client = {
    query,
    release: vi.fn(),
  };
  const db = {
    connect: vi.fn().mockResolvedValue(client),
  };

  const store = new PostgresWebhookEventStore(db as never, {
    ...getGitHubEventsConfig(),
    lockDurationMs: 45_000,
  });

  return { store, client, connect: db.connect, query };
}

describe("PostgresWebhookEventStore", () => {
  it("enqueues one row per topic without storing trace ids", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce(undefined);
    const { store, connect } = createTransactionalStore(query);

    const status = await store.enqueueEvent({
      source: "github",
      eventId: "delivery-1",
      bodySha256: "body-sha",
      repositoryId: 4_567,
      topics: ["collector", "status"],
      headers: { "x-github-event": ["workflow_run"] },
      body: Buffer.from("{}"),
    });

    expect(status).toBe("inserted");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1]?.[1]).toEqual([
      "github",
      "delivery-1",
      "collector",
      "body-sha",
      4_567,
      JSON.stringify({ "x-github-event": ["workflow_run"] }),
      Buffer.from("{}"),
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([
      "github",
      "delivery-1",
      "status",
      "body-sha",
      4_567,
      JSON.stringify({ "x-github-event": ["workflow_run"] }),
      Buffer.from("{}"),
    ]);
  });

  it("still reports duplicates when the existing body hash matches", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ body_sha256: "body-sha" }] })
      .mockResolvedValueOnce(undefined);
    const { store } = createTransactionalStore(query);

    const status = await store.enqueueEvent({
      source: "github",
      eventId: "delivery-1",
      bodySha256: "body-sha",
      repositoryId: 4_567,
      topics: ["status"],
      headers: { "x-github-event": ["workflow_run"] },
      body: Buffer.from("{}"),
    });

    expect(status).toBe("duplicate");
  });

  it("returns claimed events without trace ids", async () => {
    const { store } = createStore(
      vi.fn().mockResolvedValue({
        rows: [
          {
            id: "7",
            source: "github",
            event_id: "delivery-1",
            topic: "status",
            repository_id: "4567",
            headers: { "x-github-event": ["workflow_run"] },
            body: Buffer.from("{}"),
            attempts: 2,
          },
        ],
      }),
    );

    const events = await store.claimEvents();

    expect(events).toEqual([
      {
        id: 7,
        source: "github",
        eventId: "delivery-1",
        topic: "status",
        repositoryId: 4567,
        headers: { "x-github-event": ["workflow_run"] },
        body: Buffer.from("{}"),
        attempts: 2,
      },
    ]);
  });

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
