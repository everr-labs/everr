// @vitest-environment node
import type { TraceConsultation } from "@everr/app/organizations/consultations";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createTraceConsultations } from "./milestones";

function observation(): TraceConsultation {
  return {
    principal: {
      kind: "member",
      organizationId: "org",
      userId: "user",
      membershipId: "membership",
    },
    surface: "ui",
    traces: [
      {
        traceId: "trace",
        serviceName: "checkout",
        resourceAttributes: { "deployment.environment.name": "production" },
        spanAttributes: {},
      },
    ],
  };
}
function harness(overrides: Partial<Parameters<typeof createTraceConsultations>[0]> = {}) {
  const establish = vi.fn(async () => true);
  const publish = vi.fn();
  const log = vi.fn();
  const count = vi.fn();
  const observer = createTraceConsultations({
    store: { establish },
    events: { publish },
    diagnostics: { log, count },
    ...overrides,
  });
  return { observer, establish, publish, log, count };
}
afterEach(() => vi.useRealTimers());

it("accepts a completed customer Production trace consultation", async () => {
  const state = harness();
  expect(state.observer.observe(observation())).toBeUndefined();
  await state.observer.stop();
  expect(state.establish).toHaveBeenCalledOnce();
  expect(state.publish.mock.calls.map(([fact]) => fact.type)).toEqual([
    "telemetry.first_queryable",
    "organization.activated",
  ]);
});

it.each(["cli", "mcp"] as const)(
  "accepts authorized clients on %s without inventing a User",
  async (surface) => {
    const state = harness();
    const value = observation();
    value.surface = surface;
    value.principal = { kind: "client", organizationId: "org", clientId: "client" };
    value.traces[0].resourceAttributes = {
      "service.namespace": "cicd",
      "vcs.provider.name": "github",
      "cicd.pipeline.run.id": 123,
      "vcs.repository.name": "customer/checkout",
      "cicd.pipeline.name": "build",
    };
    state.observer.observe(value);
    await state.observer.stop();
    expect(state.establish).toHaveBeenCalledOnce();
    expect(state.publish.mock.calls[1][0]).not.toHaveProperty("actorId");
  },
);

it.each([
  ["missing membership", { principal: { kind: "member", organizationId: "org", userId: "u" } }],
  [
    "client claiming UI",
    { principal: { kind: "client", organizationId: "org", clientId: "client" } },
  ],
  ["empty result", { traces: [] }],
  ["unsupported dashboard", { surface: "dashboard" }],
  ["untrusted telemetry time", { observedAt: "2000-01-01T00:00:00Z" }],
  ["arbitrary result", { traces: [{ result: 1 }] }],
  ["too many traces", { traces: Array.from({ length: 1001 }, () => observation().traces[0]) }],
])("rejects %s without affecting completion", async (_label, changes) => {
  const state = harness();
  expect(() =>
    state.observer.observe({ ...observation(), ...changes } as TraceConsultation),
  ).not.toThrow();
  await state.observer.stop();
  expect(state.establish).not.toHaveBeenCalled();
  expect(state.publish).not.toHaveBeenCalled();
  expect(state.count).toHaveBeenCalledWith("validation");
});

it.each([
  {},
  { "deployment.environment.name": "test" },
  { "deployment.environment.name": "local" },
  { "deployment.environment.name": "", "deployment.environment": "production" },
  { "deployment.environment.name": false, "deployment.environment": "production" },
  { deployment: { environment: { name: null } }, "deployment.environment": "production" },
  { "service.namespace": "cicd" },
  { "service.name": "customer-service" },
  { "deployment.environment.name": "production", "service.namespace": "everr" },
  { "deployment.environment.name": "production", "everr.synthetic": true },
  { "deployment.environment.name": "production", everr: { demo: true } },
  { "deployment.environment.name": "production", "everr.telemetry.provenance": "test-data" },
  {
    "service.namespace": "cicd",
    "vcs.provider.name": "github",
    "cicd.pipeline.run.id": 123,
    "vcs.repository.name": "everr-labs/everr",
    "cicd.pipeline.name": "build",
  },
])("Cloud excludes unproven or non-customer data: %j", async (resourceAttributes) => {
  const state = harness();
  const value = observation();
  value.traces[0].resourceAttributes = resourceAttributes;
  state.observer.observe(value);
  await state.observer.stop();
  expect(state.establish).not.toHaveBeenCalled();
  expect(state.publish).not.toHaveBeenCalled();
  expect(state.count).not.toHaveBeenCalled();
});

it.each(["everr-app", "test-service", "verify-seed-api", "demo", "synthetic-api", "telemetrygen"])(
  "Cloud excludes service %s",
  async (serviceName) => {
    const state = harness();
    const value = observation();
    value.traces[0].serviceName = serviceName;
    state.observer.observe(value);
    await state.observer.stop();
    expect(state.establish).not.toHaveBeenCalled();
  },
);

it.each([
  { "deployment.environment": "production" },
  { deployment: { environment: { name: "production" } } },
])("accepts customer Production attribute formats %j", async (resourceAttributes) => {
  const state = harness();
  const value = observation();
  value.traces[0].resourceAttributes = resourceAttributes;
  state.observer.observe(value);
  await state.observer.stop();
  expect(state.establish).toHaveBeenCalledOnce();
});

it("captures the authorized Organization and admission time before asynchronous work", async () => {
  let instant = new Date("2026-10-23T12:00:00.123Z");
  const state = harness({ now: () => instant });
  instant = new Date("2026-10-23T12:00:01.456Z");
  const value = observation();
  state.observer.observe(value);
  value.principal.organizationId = "mutated";
  instant = new Date("2026-10-23T12:10:00Z");
  await state.observer.stop();
  expect(state.establish).toHaveBeenCalledWith(
    expect.objectContaining({
      organizationId: "org",
      surface: "ui",
      observedAt: new Date("2026-10-23T12:00:01.456Z"),
      observerStartedAt: new Date("2026-10-23T12:00:00.123Z"),
    }),
  );
});

it("reports marker failure independently of failing diagnostic implementations", async () => {
  const count = vi.fn();
  const state = harness({
    store: {
      establish: async () => {
        throw new Error("private database detail");
      },
    },
    diagnostics: {
      log: async () => {
        throw new Error("logger down");
      },
      count,
    },
  });
  expect(state.observer.observe(observation())).toBeUndefined();
  await state.observer.stop();
  expect(count).toHaveBeenCalledWith("storage");
  expect(state.publish).not.toHaveBeenCalled();
});

it("does not publish before marker commit and isolates each publication failure", async () => {
  let commit!: (value: boolean) => void;
  const publish = vi.fn(() => {
    throw new Error("publisher unavailable");
  });
  const state = harness({
    store: {
      establish: () =>
        new Promise((resolve) => {
          commit = resolve;
        }),
    },
    events: { publish },
  });
  state.observer.observe(observation());
  await Promise.resolve();
  expect(publish).not.toHaveBeenCalled();
  commit(true);
  await state.observer.stop();
  expect(publish).toHaveBeenCalledTimes(2);
  expect(state.count.mock.calls).toEqual([["publication"], ["publication"]]);
});

it("bounds admission, measures overload/closed/drain and returns completed actions immediately", async () => {
  vi.useFakeTimers();
  let release!: (value: boolean) => void;
  const state = harness({
    store: {
      establish: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    maxInFlight: 1,
    drainTimeoutMs: 10,
  });
  expect(state.observer.observe(observation())).toBeUndefined();
  expect(state.observer.observe(observation())).toBeUndefined();
  const stopped = state.observer.stop();
  state.observer.observe(observation());
  await vi.advanceTimersByTimeAsync(10);
  await stopped;
  expect(state.count.mock.calls).toEqual([["overload"], ["closed"], ["drain"]]);
  release(true);
  await Promise.resolve();
});

it("rejects impossible backwards server-clock observations", async () => {
  let instant = new Date("2026-10-23T12:00:00Z");
  const state = harness({ now: () => instant });
  instant = new Date("2026-10-22T12:00:00Z");
  state.observer.observe(observation());
  await state.observer.stop();
  expect(state.establish).not.toHaveBeenCalled();
  expect(state.count).toHaveBeenCalledWith("storage");
});

it("contains a synchronous clock failure at observation admission", async () => {
  let broken = false;
  const state = harness({
    now: () => {
      if (broken) throw new Error("private clock detail");
      return new Date();
    },
  });
  broken = true;
  expect(() => state.observer.observe(observation())).not.toThrow();
  await state.observer.stop();
  expect(state.count).toHaveBeenCalledWith("envelope");
  expect(state.establish).not.toHaveBeenCalled();
});

it("contains synchronous diagnostic failures without losing the independent counter", async () => {
  const count = vi.fn();
  const state = harness({
    diagnostics: {
      log: () => {
        throw new Error("logger failure");
      },
      count,
    },
  });
  expect(() =>
    state.observer.observe({ ...observation(), trigger: "poll" } as unknown as TraceConsultation),
  ).not.toThrow();
  await state.observer.stop();
  expect(count).toHaveBeenCalledWith("validation");
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid observation capacity %s at construction",
  (maxInFlight) => {
    expect(() => harness({ maxInFlight })).toThrow("Invalid publication capacity");
  },
);

it.each([-1, NaN, Infinity])("rejects invalid observation drain timeout %s", (drainTimeoutMs) => {
  expect(() => harness({ drainTimeoutMs })).toThrow("Invalid publication drain timeout");
});

it("persists only captured scalar context and clock times after input mutation", async () => {
  const instant = new Date("2026-10-23T12:00:00Z");
  const state = harness({ now: () => instant });
  instant.setUTCSeconds(1);
  const value = observation();
  state.observer.observe(value);
  value.principal.organizationId = "changed";
  value.traces[0].resourceAttributes = { "everr.synthetic": true };
  value.surface = "mcp";
  instant.setUTCFullYear(2000);
  expect(state.establish).not.toHaveBeenCalled();
  await state.observer.stop();
  expect(state.establish).toHaveBeenCalledWith({
    organizationId: "org",
    surface: "ui",
    observedAt: new Date("2026-10-23T12:00:01Z"),
    observerStartedAt: new Date("2026-10-23T12:00:00Z"),
  });
  expect(state.publish.mock.calls.map(([fact]) => fact)).toEqual(
    ["telemetry.first_queryable", "organization.activated"].map((type) => ({
      type,
      version: 1,
      subjectId: "org",
      data: { organizationId: "org", ruleVersion: 1, observedAt: "2026-10-23T12:00:01.000Z" },
    })),
  );
});

it("classifies an invalid admission Date as envelope failure before storage", async () => {
  let invalid = false;
  const state = harness({ now: () => new Date(invalid ? NaN : Date.now()) });
  invalid = true;
  expect(() => state.observer.observe(observation())).not.toThrow();
  await state.observer.stop();
  expect(state.count.mock.calls).toEqual([["envelope"]]);
  expect(state.establish).not.toHaveBeenCalled();
});

it("does not publish facts when persistence reports an existing marker", async () => {
  const state = harness({ store: { establish: async () => false } });
  state.observer.observe(observation());
  await state.observer.stop();
  expect(state.publish).not.toHaveBeenCalled();
  expect(state.count).not.toHaveBeenCalled();
});

it("contains rejecting runtime publishers independently after marker commit", async () => {
  const publish = vi.fn(
    () => Promise.reject(new Error("private publisher detail")) as unknown as void,
  );
  const state = harness({ events: { publish } });
  state.observer.observe(observation());
  await state.observer.stop();
  expect(publish).toHaveBeenCalledTimes(2);
  expect(state.log.mock.calls).toEqual([["publication"], ["publication"]]);
  expect(state.count.mock.calls).toEqual([["publication"], ["publication"]]);
});

it("guards the publication logger and counter independently, including rejected diagnostics", async () => {
  const log = vi.fn(() => {
    throw new Error("logger down");
  });
  const count = vi.fn(async () => {
    throw new Error("counter down");
  });
  const state = harness({
    events: {
      publish: () => {
        throw new Error("publisher down");
      },
    },
    diagnostics: { log, count },
  });
  state.observer.observe(observation());
  await state.observer.stop();
  expect(log.mock.calls).toEqual([["publication"], ["publication"]]);
  expect(count.mock.calls).toEqual([["publication"], ["publication"]]);
});

it("uses the default 32-operation capacity and 3-second idempotent shutdown budget", async () => {
  vi.useFakeTimers();
  const releases: ((value: boolean) => void)[] = [];
  const state = harness({
    store: { establish: () => new Promise((resolve) => releases.push(resolve)) },
  });
  for (let i = 0; i < 33; i++) state.observer.observe(observation());
  await Promise.resolve();
  expect(releases).toHaveLength(32);
  const stopping = state.observer.stop();
  expect(state.observer.stop()).toBe(stopping);
  let stopped = false;
  void stopping.then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(2999);
  expect(stopped).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await stopping;
  expect(state.count.mock.calls).toEqual([["overload"], ["drain"]]);
  for (const release of releases) release(false);
  await vi.runAllTimersAsync();
  expect(state.observer.stop()).toBe(stopping);
  expect(state.count.mock.calls).toEqual([["overload"], ["drain"]]);
});

it("contains a late storage rejection after bounded shutdown and closes admission immediately", async () => {
  vi.useFakeTimers();
  let rejectStorage!: (reason: Error) => void;
  const state = harness({
    store: {
      establish: () =>
        new Promise((_resolve, reject) => {
          rejectStorage = reject;
        }),
    },
    drainTimeoutMs: 0,
  });
  const { observe, stop } = state.observer;
  observe(observation());
  const stopping = stop();
  observe(observation());
  await vi.advanceTimersByTimeAsync(0);
  await stopping;
  rejectStorage(new Error("late private database detail"));
  await vi.runAllTimersAsync();
  expect(state.count.mock.calls).toEqual([["closed"], ["drain"], ["storage"]]);
  expect(state.publish).not.toHaveBeenCalled();
  expect(stop()).toBe(stopping);
});

it("releases capacity after failed storage without closing the observer", async () => {
  const establish = vi.fn(async () => {
    throw new Error("database unavailable");
  });
  const state = harness({ store: { establish }, maxInFlight: 1 });
  state.observer.observe(observation());
  await vi.waitFor(() => expect(state.count).toHaveBeenCalledWith("storage"));
  state.observer.observe(observation());
  await state.observer.stop();
  expect(establish).toHaveBeenCalledTimes(2);
  expect(state.count.mock.calls).toEqual([["storage"], ["storage"]]);
});

it("rejects an injected clock's invalid ISO string as envelope failure", async () => {
  class InvalidClock extends Date {
    override toISOString() {
      return "invalid";
    }
  }
  const state = harness({ now: () => new InvalidClock() });
  expect(() => state.observer.observe(observation())).not.toThrow();
  await state.observer.stop();
  expect(state.count.mock.calls).toEqual([["envelope"]]);
  expect(state.establish).not.toHaveBeenCalled();
});
