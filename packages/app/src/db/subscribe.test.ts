import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConnect, mockQuery, mockEnd, mockOn } = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockQuery = vi.fn().mockResolvedValue(undefined);
  const mockEnd = vi.fn().mockResolvedValue(undefined);
  const mockOn = vi.fn();
  return { mockConnect, mockQuery, mockEnd, mockOn };
});

vi.mock("pg", () => {
  class MockClient {
    connect = mockConnect;
    query = mockQuery;
    end = mockEnd;
    on = mockOn;
  }
  return { Client: MockClient };
});

vi.mock("@/env/db", () => ({
  dbEnv: {
    DATABASE_HOST: "localhost",
    DATABASE_NAME: "testdb",
    DATABASE_PORT: 5432,
    DATABASE_USER: "test",
    DATABASE_PASSWORD: "secret",
    DATABASE_SSL: undefined,
  },
}));

vi.mock("./notify", () => ({}));

import { createSubscription } from "./subscribe";

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockQuery.mockResolvedValue(undefined);
  mockEnd.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getHandler(event: string) {
  const calls = mockOn.mock.calls;
  const call = calls.find(([e]) => e === event);
  if (!call) throw new Error(`${event} handler not registered`);
  return call[1] as (...args: unknown[]) => void;
}

describe("createSubscription", () => {
  it("creates a pg.Client and connects", async () => {
    createSubscription(["tenant_42"], vi.fn(), vi.fn());
    await Promise.resolve();

    expect(mockConnect).toHaveBeenCalledOnce();
  });

  it("registers notification and error listeners before connecting", () => {
    createSubscription(["tenant_42"], vi.fn(), vi.fn());

    const events = mockOn.mock.calls.map(([e]) => e);
    expect(events).toContain("notification");
    expect(events).toContain("error");
  });

  it("LISTENs on each channel after connecting", async () => {
    createSubscription(["tenant_42", "trace_abc"], vi.fn(), vi.fn());
    await new Promise((r) => setTimeout(r, 0));

    expect(mockQuery).toHaveBeenCalledWith('LISTEN "tenant_42"');
    expect(mockQuery).toHaveBeenCalledWith('LISTEN "trace_abc"');
  });

  it("rejects unsafe channel names", async () => {
    const onError = vi.fn();
    createSubscription(['tenant_42"; DROP TABLE--'], vi.fn(), onError);
    await new Promise((r) => setTimeout(r, 0));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Unsafe") }),
    );
  });

  it("forwards parsed notification payloads to onNotification", async () => {
    const onNotification = vi.fn();
    createSubscription(["tenant_42"], onNotification, vi.fn());
    await new Promise((r) => setTimeout(r, 0));

    const handler = getHandler("notification") as (msg: {
      payload?: string;
    }) => void;
    handler({
      payload: JSON.stringify({ tenantId: 42, traceId: "abc", runId: "1" }),
    });

    expect(onNotification).toHaveBeenCalledWith({
      tenantId: 42,
      traceId: "abc",
      runId: "1",
    });
  });

  it("ignores notifications with no payload", async () => {
    const onNotification = vi.fn();
    createSubscription(["tenant_42"], onNotification, vi.fn());
    await new Promise((r) => setTimeout(r, 0));

    const handler = getHandler("notification") as (msg: {
      payload?: string;
    }) => void;
    handler({});

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("ignores notifications with unparseable payload", async () => {
    const onNotification = vi.fn();
    createSubscription(["tenant_42"], onNotification, vi.fn());
    await new Promise((r) => setTimeout(r, 0));

    const handler = getHandler("notification") as (msg: {
      payload?: string;
    }) => void;
    handler({ payload: "not-json" });

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("calls onError and cleans up when pg.Client emits error", async () => {
    const onError = vi.fn();
    createSubscription(["tenant_42"], vi.fn(), onError);
    await new Promise((r) => setTimeout(r, 0));

    const errHandler = getHandler("error") as (err: Error) => void;
    const err = new Error("connection lost");
    errHandler(err);

    await new Promise((r) => setTimeout(r, 0));

    expect(onError).toHaveBeenCalledWith(err);
    expect(mockEnd).toHaveBeenCalled();
  });

  it("UNLISTENs and ends client when cleanup is called", async () => {
    const cleanup = createSubscription(["tenant_42"], vi.fn(), vi.fn());
    await new Promise((r) => setTimeout(r, 0));

    cleanup();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockQuery).toHaveBeenCalledWith("UNLISTEN *");
    expect(mockEnd).toHaveBeenCalled();
  });

  it("cleanup is idempotent — calling twice only disconnects once", async () => {
    const cleanup = createSubscription(["tenant_42"], vi.fn(), vi.fn());
    await new Promise((r) => setTimeout(r, 0));

    cleanup();
    cleanup();
    await new Promise((r) => setTimeout(r, 0));

    const unlistenCalls = mockQuery.mock.calls.filter(
      ([q]) => q === "UNLISTEN *",
    );
    expect(unlistenCalls).toHaveLength(1);
  });
});
