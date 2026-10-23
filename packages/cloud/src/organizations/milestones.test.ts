// @vitest-environment node
import type { UsefulConsultation } from "@everr/app/organizations/consultations";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createUsefulConsultations } from "./milestones";

function observation(): UsefulConsultation {
  return {
    organizationId: "org",
    principal: {
      kind: "member",
      organizationId: "org",
      userId: "user",
      membershipId: "membership",
      authorization: "current-membership",
    },
    data: { organizationId: "org", origin: "production", provenance: "own-customer-telemetry" },
    trigger: "user",
    completion: "succeeded",
    evidence: { kind: "detail", surface: "ui", entity: "trace", matchedOwnRecords: 1 },
  };
}
function harness(overrides: Partial<Parameters<typeof createUsefulConsultations>[0]> = {}) {
  const establish = vi.fn(async () => true);
  const publish = vi.fn();
  const log = vi.fn();
  const count = vi.fn();
  const observer = createUsefulConsultations({
    store: { establish },
    events: { publish },
    diagnostics: { log, count },
    ...overrides,
  });
  return { observer, establish, publish, log, count };
}
afterEach(() => vi.useRealTimers());

it.each(["trace", "log", "error", "ci-run"] as const)(
  "accepts completed own-data %s detail consultation",
  async (entity) => {
    const state = harness();
    const value = observation();
    value.evidence = { kind: "detail", surface: "ui", entity, matchedOwnRecords: 1 };
    expect(state.observer.observe(value)).toBeUndefined();
    await state.observer.stop();
    expect(state.establish).toHaveBeenCalledOnce();
    expect(state.publish.mock.calls.map(([fact]) => fact.type)).toEqual([
      "telemetry.first_queryable",
      "organization.activated",
    ]);
  },
);

it.each(["cli", "mcp"] as const)(
  "accepts an explicitly authorized Organization client on %s without inventing a User",
  async (surface) => {
    const state = harness();
    const value = observation();
    value.principal = {
      kind: "client",
      organizationId: "org",
      clientId: "authorized-client",
      authorization: "organization-query",
    };
    value.data.origin = "ci";
    value.trigger = "agent-request";
    value.evidence = {
      kind: "query",
      surface,
      purpose: "telemetry-analysis",
      matchedOwnRecords: 4,
    };
    state.observer.observe(value);
    await state.observer.stop();
    expect(state.establish).toHaveBeenCalledOnce();
    expect(state.publish.mock.calls[1][0]).not.toHaveProperty("actorId");
  },
);

it("accepts one initial populated dashboard consultation", async () => {
  const state = harness();
  state.observer.observe({
    ...observation(),
    evidence: { kind: "dashboard", surface: "ui", initialConsultation: true, renderedOwnPanels: 2 },
  });
  await state.observer.stop();
  expect(state.establish).toHaveBeenCalledOnce();
});

it.each([
  ["mismatched data Organization", { data: { ...observation().data, organizationId: "other" } }],
  [
    "mismatched principal Organization",
    { principal: { ...observation().principal, organizationId: "other" } },
  ],
  [
    "missing authorization",
    { principal: { kind: "client", organizationId: "org", clientId: "client" } },
  ],
  [
    "client claiming a UI consultation",
    {
      principal: {
        kind: "client",
        organizationId: "org",
        clientId: "client",
        authorization: "organization-query",
      },
    },
  ],
  ["empty result", { evidence: { ...observation().evidence, matchedOwnRecords: 0 } }],
  [
    "probe",
    { evidence: { kind: "query", surface: "cli", purpose: "probe", matchedOwnRecords: 1 } },
  ],
  [
    "SELECT 1",
    { evidence: { kind: "query", surface: "mcp", purpose: "select-1", matchedOwnRecords: 1 } },
  ],
  ["unattended polling", { trigger: "poll" }],
  ["backfill", { trigger: "backfill" }],
  [
    "redundant refresh",
    {
      evidence: {
        kind: "dashboard",
        surface: "ui",
        initialConsultation: false,
        renderedOwnPanels: 1,
      },
    },
  ],
  [
    "empty dashboard",
    {
      evidence: {
        kind: "dashboard",
        surface: "ui",
        initialConsultation: true,
        renderedOwnPanels: 0,
      },
    },
  ],
  ["failed completion", { completion: "failed" }],
  ["Local data", { data: { ...observation().data, origin: "local" } }],
  ...["test-data", "demo", "synthetic", "internal-everr"].map((provenance): [string, object] => [
    provenance,
    { data: { ...observation().data, provenance } },
  ]),
  ["untrusted telemetry timestamp", { observedAt: "2000-01-01T00:00:00Z" }],
  ["only nonempty result", { evidence: { matchedOwnRecords: 1 } }],
  ["subscription", { evidence: { kind: "subscription", status: "active" } }],
  ["provisioning", { evidence: { kind: "provisioning", ready: true } }],
  ["usage", { evidence: { kind: "usage", bytes: 512 } }],
  ["key creation", { evidence: { kind: "api-key-created" } }],
])("rejects %s without attempting persistence or affecting completion", async (_label, changes) => {
  const state = harness();
  const invalid = { ...observation(), ...(changes as object) } as UsefulConsultation;
  expect(() => state.observer.observe(invalid)).not.toThrow();
  await state.observer.stop();
  expect(state.establish).not.toHaveBeenCalled();
  expect(state.publish).not.toHaveBeenCalled();
  expect(state.count).toHaveBeenCalledWith("validation");
});

it("copies evidence before asynchronous work and uses admission time, not persistence time", async () => {
  let instant = new Date("2026-10-23T12:00:00.123Z");
  const state = harness({ now: () => instant });
  instant = new Date("2026-10-23T12:00:01.456Z");
  const value = observation();
  state.observer.observe(value);
  value.data.organizationId = "mutated";
  instant = new Date("2026-10-23T12:10:00Z");
  await state.observer.stop();
  expect(state.establish).toHaveBeenCalledWith(
    expect.objectContaining({
      evidence: expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org" }),
      }),
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
    state.observer.observe({ ...observation(), trigger: "poll" } as unknown as UsefulConsultation),
  ).not.toThrow();
  await state.observer.stop();
  expect(count).toHaveBeenCalledWith("validation");
});
