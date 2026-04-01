import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotifyPayload } from "./notify";

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

import { NotificationHub } from "./notification-hub";

function makePayload(overrides: Partial<NotifyPayload> = {}): NotifyPayload {
  return {
    tenantId: 42,
    traceId: "trace-1",
    runId: "run-1",
    sha: "abc123",
    authorEmail: null,
    ...overrides,
  };
}

describe("NotificationHub", () => {
  let hub: NotificationHub;

  beforeEach(() => {
    hub = new NotificationHub();
  });

  describe("subscribe and dispatch", () => {
    it("dispatches to tenant subscribers by tenantId", () => {
      const cb = vi.fn();
      hub.subscribe("tenant", "42", cb);
      hub.dispatch(makePayload());
      expect(cb).toHaveBeenCalledWith(makePayload());
    });

    it("dispatches to trace subscribers by tenantId:traceId", () => {
      const cb = vi.fn();
      hub.subscribe("trace", "42:trace-1", cb);
      hub.dispatch(makePayload());
      expect(cb).toHaveBeenCalledWith(makePayload());
    });

    it("dispatches to commit subscribers by tenantId:sha", () => {
      const cb = vi.fn();
      hub.subscribe("commit", "42:abc123", cb);
      hub.dispatch(makePayload());
      expect(cb).toHaveBeenCalledWith(makePayload());
    });

    it("does not dispatch to non-matching keys", () => {
      const cb = vi.fn();
      hub.subscribe("tenant", "99", cb);
      hub.dispatch(makePayload());
      expect(cb).not.toHaveBeenCalled();
    });

    it("dispatches to multiple subscribers on the same key", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      hub.subscribe("tenant", "42", cb1);
      hub.subscribe("tenant", "42", cb2);
      hub.dispatch(makePayload());
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it("dispatches across all topics for one payload", () => {
      const tenantCb = vi.fn();
      const traceCb = vi.fn();
      const commitCb = vi.fn();
      hub.subscribe("tenant", "42", tenantCb);
      hub.subscribe("trace", "42:trace-1", traceCb);
      hub.subscribe("commit", "42:abc123", commitCb);
      hub.dispatch(makePayload());
      expect(tenantCb).toHaveBeenCalledOnce();
      expect(traceCb).toHaveBeenCalledOnce();
      expect(commitCb).toHaveBeenCalledOnce();
    });
  });

  describe("unsubscribe", () => {
    it("removes subscriber so it no longer receives dispatches", () => {
      const cb = vi.fn();
      const unsub = hub.subscribe("tenant", "42", cb);
      unsub();
      hub.dispatch(makePayload());
      expect(cb).not.toHaveBeenCalled();
    });

    it("is idempotent — calling twice does not throw", () => {
      const cb = vi.fn();
      const unsub = hub.subscribe("tenant", "42", cb);
      unsub();
      unsub();
      hub.dispatch(makePayload());
      expect(cb).not.toHaveBeenCalled();
    });

    it("does not affect other subscribers on the same key", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const unsub1 = hub.subscribe("tenant", "42", cb1);
      hub.subscribe("tenant", "42", cb2);
      unsub1();
      hub.dispatch(makePayload());
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it("cleans up empty Sets from the index", () => {
      const cb = vi.fn();
      const unsub = hub.subscribe("tenant", "42", cb);
      unsub();
      expect(hub.subscriberCount("tenant", "42")).toBe(0);
    });
  });

  describe("dispatch edge cases", () => {
    it("ignores payloads with no matching subscribers", () => {
      hub.dispatch(makePayload());
    });

    it("continues dispatching to remaining subscribers if one throws", () => {
      const bad = vi.fn(() => {
        throw new Error("boom");
      });
      const good = vi.fn();
      hub.subscribe("tenant", "42", bad);
      hub.subscribe("tenant", "42", good);
      hub.dispatch(makePayload());
      expect(bad).toHaveBeenCalledOnce();
      expect(good).toHaveBeenCalledOnce();
    });
  });
});

function getHandler(event: string) {
  const call = mockOn.mock.calls.find((c) => c[0] === event);
  if (!call) throw new Error(`${event} handler not registered`);
  return call[1] as (...args: unknown[]) => void;
}

describe("NotificationHub — pg.Client lifecycle", () => {
  let hub: NotificationHub;

  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockOn.mockReset();
    hub = new NotificationHub();
  });

  afterEach(async () => {
    await hub.shutdown();
  });

  it("start() connects and LISTENs on 'workflows'", async () => {
    await hub.start();
    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockQuery).toHaveBeenCalledWith('LISTEN "workflows"');
  });

  it("dispatches parsed notification payloads to subscribers", async () => {
    const cb = vi.fn();
    hub.subscribe("tenant", "42", cb);

    await hub.start();

    const notificationHandler = getHandler("notification");
    const payload = makePayload();
    notificationHandler({ payload: JSON.stringify(payload) });

    expect(cb).toHaveBeenCalledWith(payload);
  });

  it("ignores notifications with missing payload", async () => {
    const cb = vi.fn();
    hub.subscribe("tenant", "42", cb);

    await hub.start();

    const notificationHandler = getHandler("notification");
    notificationHandler({ payload: undefined });

    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores notifications with unparseable payload", async () => {
    const cb = vi.fn();
    hub.subscribe("tenant", "42", cb);

    await hub.start();

    const notificationHandler = getHandler("notification");
    notificationHandler({ payload: "not-json{" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("shutdown() ends the client", async () => {
    await hub.start();
    await hub.shutdown();
    expect(mockEnd).toHaveBeenCalled();
  });
});

describe("NotificationHub — author topic", () => {
  let hub: NotificationHub;

  beforeEach(() => {
    hub = new NotificationHub();
  });

  it("dispatches to author topic when authorEmail is present", () => {
    const callback = vi.fn();
    hub.subscribe("author", "42:dev@example.com", callback);

    const payload: NotifyPayload = {
      tenantId: 42,
      traceId: "t1",
      runId: "r1",
      sha: "abc",
      authorEmail: "dev@example.com",
    };
    hub.dispatch(payload);

    expect(callback).toHaveBeenCalledWith(payload);
  });

  it("does not dispatch to author topic when authorEmail is null", () => {
    const callback = vi.fn();
    hub.subscribe("author", "42:null", callback);

    hub.dispatch({
      tenantId: 42,
      traceId: "t1",
      runId: "r1",
      sha: "abc",
      authorEmail: null,
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not dispatch to unrelated author subscribers", () => {
    const callback = vi.fn();
    hub.subscribe("author", "42:other@example.com", callback);

    hub.dispatch({
      tenantId: 42,
      traceId: "t1",
      runId: "r1",
      sha: "abc",
      authorEmail: "dev@example.com",
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("still dispatches to tenant, trace, and commit topics", () => {
    const tenantCb = vi.fn();
    const traceCb = vi.fn();
    const commitCb = vi.fn();
    hub.subscribe("tenant", "42", tenantCb);
    hub.subscribe("trace", "42:t1", traceCb);
    hub.subscribe("commit", "42:abc", commitCb);

    hub.dispatch({
      tenantId: 42,
      traceId: "t1",
      runId: "r1",
      sha: "abc",
      authorEmail: "dev@example.com",
    });

    expect(tenantCb).toHaveBeenCalledOnce();
    expect(traceCb).toHaveBeenCalledOnce();
    expect(commitCb).toHaveBeenCalledOnce();
  });

  it("unsubscribe removes the callback", () => {
    const callback = vi.fn();
    const unsub = hub.subscribe("author", "42:dev@example.com", callback);
    unsub();

    hub.dispatch({
      tenantId: 42,
      traceId: "t1",
      runId: "r1",
      sha: "abc",
      authorEmail: "dev@example.com",
    });

    expect(callback).not.toHaveBeenCalled();
  });
});

describe("NotificationHub — reconnect", () => {
  let hub: NotificationHub;

  beforeEach(() => {
    vi.useFakeTimers();
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockOn.mockReset();
    hub = new NotificationHub();
  });

  afterEach(async () => {
    await hub.shutdown();
    vi.useRealTimers();
  });

  it("reconnects after pg.Client emits error (after 1s backoff)", async () => {
    await hub.start();
    expect(mockConnect).toHaveBeenCalledTimes(1);

    const errorHandler = getHandler("error");
    errorHandler(new Error("connection lost"));

    // Reset mocks to track reconnect calls
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset().mockResolvedValue(undefined);
    mockOn.mockReset();

    await vi.advanceTimersByTimeAsync(1000);

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith('LISTEN "workflows"');
  });

  it("uses exponential backoff on consecutive failures", async () => {
    // First connect succeeds
    await hub.start();

    // First failure — should reconnect after 1s
    const errorHandler = getHandler("error");
    errorHandler(new Error("fail"));

    mockConnect.mockReset().mockRejectedValue(new Error("still down"));
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockOn.mockReset();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Second failure — should reconnect after 2s
    mockConnect.mockReset().mockRejectedValue(new Error("still down"));
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockOn.mockReset();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockConnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("resets backoff after successful reconnect", async () => {
    await hub.start();

    // Trigger disconnect
    const errorHandler = getHandler("error");
    errorHandler(new Error("fail"));

    // Reconnect succeeds after 1s
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset().mockResolvedValue(undefined);
    mockOn.mockReset();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Trigger another disconnect — should backoff 1s again (reset)
    const errorHandler2 = getHandler("error");
    errorHandler2(new Error("fail again"));

    mockConnect.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset().mockResolvedValue(undefined);
    mockOn.mockReset();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
