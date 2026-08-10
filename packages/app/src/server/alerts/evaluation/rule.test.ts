import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  definition: null as unknown,
  // The row a failure transaction's FOR UPDATE re-read sees. Defaults to
  // mirror `definition`; tests that need to simulate a concurrent pause or
  // delete between the outer read and the failure transaction override it.
  freshDefinition: undefined as Record<string, unknown> | null | undefined,
  // The alert_instances rows a fresh evaluateAlertRule call reads back, as
  // if they were the previous call's persisted state.
  instanceRows: [] as Record<string, unknown>[],
  instanceUpserts: [] as Record<string, unknown>[],
  eventRows: [] as Record<string, unknown>[],
  query: vi.fn(),
  transaction: vi.fn(),
  definitionUpdates: [] as Record<string, unknown>[],
  scheduledJobs: [] as { task: string; payload: unknown }[],
  history: vi.fn(),
  previewAlerts: "on" as "on" | "off",
}));

vi.mock("@/env", () => ({
  env: {
    get EVERR_PREVIEW_ALERTS() {
      return mocks.previewAlerts;
    },
  },
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        // The two reads differ in shape: the definition lookup ends in
        // .limit(1), the instance lookup awaits .where() directly.
        where: () =>
          Object.assign(Promise.resolve(mocks.instanceRows), {
            limit: () => Promise.resolve([mocks.definition]),
          }),
      }),
    }),
    transaction: mocks.transaction,
  },
  pool: {},
}));

vi.mock("@/lib/clickhouse", () => ({ querySqlApiWithMeta: mocks.query }));

vi.mock("@/server/worker/jobs", () => ({
  addWorkerJobInTransaction: (_tx: unknown, task: string, payload: unknown) => {
    mocks.scheduledJobs.push({ task, payload });
    return Promise.resolve();
  },
}));

vi.mock("../history/clickhouse", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordAlertHistory: mocks.history,
}));

import { ALERT_EVALUATE_TASK } from "@/data/alerting/scheduling/evaluation-jobs.server";
import { alertEvaluations, alertEvents, alertInstances } from "@/db/schema";
import { ALERT_PROCESS_EVENT_TASK } from "../delivery/tasks";
import {
  evaluateAlert,
  isNoopInactiveTransition,
  shouldEnqueueProcessEvent,
  transitionEventRows,
} from "./rule";
import type { AlertInstanceTransition } from "./state-machine";

/** Records what the failure path writes, without a database behind it. */
function recordingTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({
            limit: () => {
              const fresh =
                mocks.freshDefinition === undefined
                  ? { active: true, version: 3, consecutiveFailures: 0 }
                  : mocks.freshDefinition;
              return Promise.resolve(fresh === null ? [] : [fresh]);
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([{ alertDefinitionId: RULE_ID }]),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.definitionUpdates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  };
}

/**
 * Drives the real success-path transaction: the FOR UPDATE guard, the
 * alert_evaluations dedup insert, and a table-aware insert() that applies
 * INSERT ... ON CONFLICT DO UPDATE semantics against `mocks.instanceRows`
 * (unset fields on a conflict keep the existing row's value, the same way
 * Postgres does), so a later evaluateAlert call reading previousRows sees
 * exactly what this one persisted.
 */
function fullTx(opts?: {
  active?: boolean;
  version?: number;
  applies?: boolean;
}) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({
            limit: () =>
              Promise.resolve(
                (opts?.active ?? true)
                  ? [
                      {
                        active: true,
                        version: opts?.version ?? definition.version,
                      },
                    ]
                  : [],
              ),
          }),
        }),
      }),
    }),
    insert: (table: unknown) => {
      if (table === alertEvaluations) {
        return {
          values: () => ({
            onConflictDoNothing: () => ({
              returning: () =>
                Promise.resolve(
                  (opts?.applies ?? true)
                    ? [{ alertDefinitionId: RULE_ID }]
                    : [],
                ),
            }),
          }),
        };
      }
      if (table === alertInstances) {
        return {
          values: (row: Record<string, unknown>) => ({
            onConflictDoUpdate: (upsert: { set: Record<string, unknown> }) => {
              const existing = mocks.instanceRows.find(
                (candidate) => candidate.fingerprint === row.fingerprint,
              );
              mocks.instanceUpserts.push(
                existing ? { ...existing, ...upsert.set } : row,
              );
              return Promise.resolve();
            },
          }),
        };
      }
      if (table === alertEvents) {
        return {
          values: (rows: Record<string, unknown>[]) => {
            mocks.eventRows.push(...rows);
            return Promise.resolve();
          },
        };
      }
      throw new Error("fullTx: unexpected insert table");
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.definitionUpdates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  };
}

/** Feeds the previous call's persisted instance rows into the next call. */
function persistInstances() {
  mocks.instanceRows = mocks.instanceUpserts;
  mocks.instanceUpserts = [];
}

const RULE_ID = "6f1c9d20-3b7a-4c11-9f2e-8a5d4c3b2a10";

const definition = {
  id: RULE_ID,
  organizationId: "org-1",
  repoid: "host/owner/repo",
  previewId: null,
  slug: "default/high-5xx",
  active: true,
  version: 3,
  consecutiveFailures: 0,
  lastSeenAt: null,
  lastFiredAt: null,
  lastResolvedAt: null,
  spec: {
    sql: "SELECT 1",
    severity: "critical",
    suppressed: false,
    interval_secs: 60,
    for_secs: 0,
    resolve_after: 1,
    label_columns: ["service"],
    condition: { operator: "gt", threshold: 0 },
    annotations: {},
  },
};

const payload = {
  alertDefinitionId: RULE_ID,
  scheduledFor: "2026-08-06T10:00:00.000Z",
  ruleVersion: 3,
};

describe("evaluateAlert scheduling state", () => {
  beforeEach(() => {
    mocks.definition = definition;
    mocks.freshDefinition = undefined;
    mocks.instanceRows = [];
    mocks.instanceUpserts = [];
    mocks.eventRows = [];
    mocks.definitionUpdates = [];
    mocks.scheduledJobs = [];
    mocks.query.mockReset();
    mocks.transaction.mockReset();
    mocks.history.mockReset().mockResolvedValue(undefined);
    mocks.previewAlerts = "on";
  });

  // The switch must end running chains, not only gate the scanner: the
  // evaluation neither runs nor reschedules itself, so preview load actually
  // stops. The scanner backstop resumes the chain when the switch returns.
  it("stops a preview chain when the kill switch is off", async () => {
    mocks.definition = {
      ...definition,
      previewId: "0f1c9d20-3b7a-4c11-9f2e-8a5d4c3b2a10",
    };
    mocks.previewAlerts = "off";

    await evaluateAlert(payload);

    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.scheduledJobs).toEqual([]);
  });

  it("reschedules when the failure happens after the ClickHouse query", async () => {
    // The regression: only query errors reached the failure path. Anything
    // thrown later escaped, Graphile exhausted its retries, and because
    // lastEnqueuedAt stayed at or after nextEvaluationAt the scanner never
    // selected the rule again.
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.transaction
      .mockRejectedValueOnce(new Error("instance write blew up"))
      .mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) =>
        cb(recordingTx()),
      );

    await expect(evaluateAlert(payload)).resolves.toBeUndefined();

    expect(mocks.definitionUpdates).toContainEqual(
      expect.objectContaining({ healthStatus: "degraded" }),
    );
    expect(mocks.definitionUpdates).toContainEqual(
      expect.objectContaining({ nextEvaluationAt: expect.any(Date) }),
    );
    expect(mocks.scheduledJobs).toContainEqual(
      expect.objectContaining({ task: ALERT_EVALUATE_TASK }),
    );
  });

  // The regression: only nextEvaluationAt advanced, so the scanner's
  // lastEnqueuedAt < nextEvaluationAt clause stayed permanently true and it
  // re-enqueued every rule on every tick, on top of whatever chain the rule
  // itself was already running.
  it("advances lastEnqueuedAt together with nextEvaluationAt on reschedule", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.transaction
      .mockRejectedValueOnce(new Error("instance write blew up"))
      .mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) =>
        cb(recordingTx()),
      );

    await evaluateAlert(payload);

    const reschedule = mocks.definitionUpdates.find(
      (update) => "nextEvaluationAt" in update,
    );
    expect(reschedule).toBeDefined();
    expect(reschedule?.lastEnqueuedAt).toEqual(reschedule?.nextEvaluationAt);
  });

  // A pause or delete racing the failed evaluation must win: writing the
  // rule back degraded with a queued retry would resurrect a rule the user
  // just turned off, and a deleted rule's id would violate the
  // alert_evaluations foreign key.
  it("drops the failure silently when the rule went inactive mid-flight", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.freshDefinition = {
      active: false,
      version: 3,
      consecutiveFailures: 0,
    };
    mocks.transaction
      .mockRejectedValueOnce(new Error("instance write blew up"))
      .mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) =>
        cb(recordingTx()),
      );

    await expect(evaluateAlert(payload)).resolves.toBeUndefined();

    expect(mocks.definitionUpdates).toEqual([]);
    expect(mocks.scheduledJobs).toEqual([]);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("drops the failure silently when the rule was deleted mid-flight", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.freshDefinition = null;
    mocks.transaction
      .mockRejectedValueOnce(new Error("instance write blew up"))
      .mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) =>
        cb(recordingTx()),
      );

    await expect(evaluateAlert(payload)).resolves.toBeUndefined();

    expect(mocks.definitionUpdates).toEqual([]);
    expect(mocks.scheduledJobs).toEqual([]);
  });

  it("drops the failure silently when the rule's spec version moved on", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.freshDefinition = {
      active: true,
      version: 4,
      consecutiveFailures: 0,
    };
    mocks.transaction
      .mockRejectedValueOnce(new Error("instance write blew up"))
      .mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) =>
        cb(recordingTx()),
      );

    await expect(evaluateAlert(payload)).resolves.toBeUndefined();

    expect(mocks.definitionUpdates).toEqual([]);
    expect(mocks.scheduledJobs).toEqual([]);
  });

  it("records the failure reason for a non-query error", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.transaction
      .mockRejectedValueOnce(new Error("instance write blew up"))
      .mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) =>
        cb(recordingTx()),
      );

    await evaluateAlert(payload);

    expect(mocks.definitionUpdates).toContainEqual(
      expect.objectContaining({ lastError: "instance write blew up" }),
    );
  });

  it("does not touch scheduling for a payload it cannot parse", async () => {
    await evaluateAlert({ nope: true });

    expect(mocks.definitionUpdates).toEqual([]);
    expect(mocks.scheduledJobs).toEqual([]);
  });
});

describe("transitionEventRows episode stamping", () => {
  const evaluatedAt = new Date("2026-08-06T10:00:00Z");
  const episodeDef = {
    ...definition,
    spec: {
      ...definition.spec,
      condition: { operator: "gt", threshold: 0 },
    },
  } as unknown as Parameters<typeof transitionEventRows>[0]["def"];
  const historyDef = {
    id: RULE_ID,
    organizationId: "org-1",
    repoid: "host/owner/repo",
    slug: "default/high-5xx",
    previewId: null,
    severity: "critical",
    ruleMuted: false,
  };

  function transition(
    event: AlertInstanceTransition["event"],
  ): AlertInstanceTransition {
    return {
      next: {
        fingerprint: "api",
        status:
          event === "firing"
            ? "firing"
            : event === "pending"
              ? "pending"
              : "inactive",
        labels: { service: "api" },
        evidence: { value: 1 },
        value: 1,
        pendingSince: event === "pending" ? evaluatedAt : null,
        activeSince: event === "firing" ? evaluatedAt : null,
        lastSeenAt: evaluatedAt,
        absentCount: 0,
      },
      event,
    };
  }

  it("opens the episode on fire and carries it onto the resolve", () => {
    const [fired] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("firing"),
      evaluatedAt,
      storedEpisodeId: null,
    });
    expect(fired?.outbox.episodeId).toBe(fired?.outbox.id);
    expect(fired?.history.episode_id).toBe(fired?.outbox.id);
    expect(fired?.episodeUpdate).toBe(fired?.outbox.id);

    const [resolved] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("resolved"),
      evaluatedAt,
      storedEpisodeId: fired?.outbox.id ?? null,
    });
    expect(resolved?.outbox.episodeId).toBe(fired?.outbox.id);
    expect(resolved?.history.episode_id).toBe(fired?.outbox.id);
    // The resolve closes the episode: the instance's open episode clears.
    expect(resolved?.episodeUpdate).toBeNull();
  });

  it("mints a fresh episode id for a second fire", () => {
    const args = {
      def: episodeDef,
      historyDef,
      transition: transition("firing"),
      evaluatedAt,
      storedEpisodeId: null,
    };
    const [first] = transitionEventRows(args);
    const [second] = transitionEventRows(args);
    expect(first?.outbox.episodeId).toBeDefined();
    expect(second?.outbox.episodeId).not.toBe(first?.outbox.episodeId);
  });

  it("writes the zero sentinel when a resolve finds no open episode", () => {
    const [resolved] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("resolved"),
      evaluatedAt,
      storedEpisodeId: null,
    });
    expect(resolved?.outbox.episodeId).toBeNull();
    expect(resolved?.history.episode_id).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("returns nothing when the evaluation caused no transition", () => {
    expect(
      transitionEventRows({
        def: episodeDef,
        historyDef,
        transition: transition(null),
        evaluatedAt,
        storedEpisodeId: null,
      }),
    ).toEqual([]);
  });

  it("opens the episode at pending and lets the fire inherit it", () => {
    const [pending] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("pending"),
      evaluatedAt,
      storedEpisodeId: null,
    });
    expect(pending?.outbox.eventType).toBe("instance_pending");
    expect(pending?.outbox.episodeId).toBe(pending?.outbox.id);
    expect(pending?.episodeUpdate).toBe(pending?.outbox.id);

    const [fired] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("firing"),
      evaluatedAt,
      storedEpisodeId: pending?.outbox.id ?? null,
    });
    expect(fired?.outbox.episodeId).toBe(pending?.outbox.id);
    expect(fired?.history.episode_id).toBe(pending?.outbox.id);
    expect(fired?.episodeUpdate).toBe(pending?.outbox.id);
  });

  it("journals pending born processed, state kind, and outside any chain", () => {
    const [pending] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("pending"),
      evaluatedAt,
      storedEpisodeId: null,
    });
    expect(pending?.outbox.kind).toBe("state");
    expect(pending?.outbox.processedAt).toEqual(evaluatedAt);
    expect(pending?.history.notification_event_id).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("closes a cleared pending with instance_closed and its reason", () => {
    const episodeId = "019c3ab6-54d6-7e26-bc76-8cadd67542fb";
    const [closed] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("pending_cleared"),
      evaluatedAt,
      storedEpisodeId: episodeId,
    });
    expect(closed?.outbox.eventType).toBe("instance_closed");
    expect(closed?.outbox.kind).toBe("state");
    expect(closed?.outbox.processedAt).toEqual(evaluatedAt);
    expect(closed?.outbox.reason).toBe("pending_cleared");
    expect(closed?.outbox.episodeId).toBe(episodeId);
    expect(closed?.history.episode_id).toBe(episodeId);
    expect(closed?.history.reason).toBe("pending_cleared");
    expect(closed?.history.notification_event_id).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    // The terminal closes the episode: the instance's open episode clears.
    expect(closed?.episodeUpdate).toBeNull();
  });

  it("stamps condition_cleared on a resolve", () => {
    const [resolved] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("resolved"),
      evaluatedAt,
      storedEpisodeId: null,
    });
    expect(resolved?.outbox.reason).toBe("condition_cleared");
    expect(resolved?.outbox.kind).toBe("notifying");
    expect(resolved?.history.reason).toBe("condition_cleared");
  });

  // The caller (evaluateAlertRule) computes bounded evidence once per
  // transition and passes it in so it is not recomputed here from the same
  // inputs.
  it("uses the caller's precomputed bounded evidence instead of recomputing it", () => {
    const [fired] = transitionEventRows({
      def: episodeDef,
      historyDef,
      transition: transition("firing"),
      evaluatedAt,
      storedEpisodeId: null,
      bounded: { evidence: { injected: "marker" }, truncated: true },
    });
    expect(fired?.history.evidence_json).toBe(
      JSON.stringify({ injected: "marker" }),
    );
    expect(fired?.history.evidence_truncated).toBe(true);
  });
});

describe("shouldEnqueueProcessEvent", () => {
  const evaluatedAt = new Date("2026-08-06T10:00:00Z");
  const args = (status: "pending" | "firing") => ({
    def: {
      ...definition,
      spec: { ...definition.spec, condition: { operator: "gt", threshold: 0 } },
    } as unknown as Parameters<typeof transitionEventRows>[0]["def"],
    historyDef: {
      id: RULE_ID,
      organizationId: "org-1",
      repoid: "host/owner/repo",
      slug: "default/high-5xx",
      previewId: null,
      severity: "critical",
      ruleMuted: false,
    },
    transition: {
      next: {
        fingerprint: "api",
        status,
        labels: { service: "api" },
        evidence: { value: 1 },
        value: 1,
        pendingSince: status === "pending" ? evaluatedAt : null,
        activeSince: status === "firing" ? evaluatedAt : null,
        lastSeenAt: evaluatedAt,
        absentCount: 0,
      },
      event: status,
    } as AlertInstanceTransition,
    evaluatedAt,
    storedEpisodeId: null,
  });

  it("never enqueues a process job for a born-processed state row", () => {
    const [pending] = transitionEventRows(args("pending"));
    expect(pending?.outbox.kind).toBe("state");
    expect(shouldEnqueueProcessEvent(pending?.outbox ?? {})).toBe(false);
  });

  it("enqueues for notifying transitions", () => {
    const [fired] = transitionEventRows(args("firing"));
    expect(fired?.outbox.kind).not.toBe("state");
    expect(shouldEnqueueProcessEvent(fired?.outbox ?? {})).toBe(true);
  });
});

describe("isNoopInactiveTransition", () => {
  const evaluatedAt = new Date("2026-08-06T10:00:00Z");
  const inactiveInstance = {
    fingerprint: "api",
    status: "inactive" as const,
    labels: { service: "api" },
    evidence: {},
    value: null,
    pendingSince: null,
    activeSince: null,
    lastSeenAt: evaluatedAt,
    absentCount: 0,
  };

  it("is true for a row that stayed inactive with no event", () => {
    expect(
      isNoopInactiveTransition({ next: inactiveInstance, event: null }),
    ).toBe(true);
  });

  it("is false once an event fires, even if the row lands inactive", () => {
    expect(
      isNoopInactiveTransition({
        next: inactiveInstance,
        event: "pending_cleared",
      }),
    ).toBe(false);
  });

  it("is false for a live status with no event, such as a held pending", () => {
    expect(
      isNoopInactiveTransition({
        next: { ...inactiveInstance, status: "pending" },
        event: null,
      }),
    ).toBe(false);
  });
});

describe("evaluateAlert full evaluation lifecycle", () => {
  const scheduledAt = (minute: number) => ({
    ...payload,
    scheduledFor: `2026-08-06T10:0${minute}:00.000Z`,
  });

  beforeEach(() => {
    mocks.definition = definition;
    mocks.instanceRows = [];
    mocks.instanceUpserts = [];
    mocks.eventRows = [];
    mocks.definitionUpdates = [];
    mocks.scheduledJobs = [];
    mocks.query.mockReset();
    mocks.transaction.mockReset();
    mocks.history.mockReset().mockResolvedValue(undefined);
    mocks.previewAlerts = "on";
  });

  it("drives an instance through fire, hold, and resolve across three evaluations", async () => {
    // Fire: the first breaching evaluation, from no prior instance.
    mocks.query.mockResolvedValueOnce({
      rows: [{ service: "api", value: 5 }],
    });
    mocks.transaction.mockImplementationOnce(
      (cb: (tx: unknown) => Promise<unknown>) => cb(fullTx()),
    );
    await evaluateAlert(scheduledAt(0));

    expect(mocks.eventRows).toHaveLength(1);
    expect(mocks.eventRows[0]).toMatchObject({
      eventType: "instance_fired",
      kind: "notifying",
    });
    const firedEventId = mocks.eventRows[0].id as string;
    expect(mocks.scheduledJobs).toContainEqual(
      expect.objectContaining({
        task: ALERT_PROCESS_EVENT_TASK,
        payload: { eventId: firedEventId },
      }),
    );
    expect(mocks.instanceUpserts).toHaveLength(1);
    expect(mocks.instanceUpserts[0]).toMatchObject({
      status: "firing",
      value: 5,
      episodeId: firedEventId,
    });
    expect(mocks.definitionUpdates).toContainEqual(
      expect.objectContaining({
        currentState: "firing",
        firingInstanceCount: 1,
      }),
    );

    persistInstances();
    mocks.eventRows = [];
    mocks.scheduledJobs = [];
    mocks.definitionUpdates = [];

    // Hold: still breaching, so no new event, but the instance row keeps
    // tracking the latest value on the episode fire already opened.
    mocks.query.mockResolvedValueOnce({
      rows: [{ service: "api", value: 7 }],
    });
    mocks.transaction.mockImplementationOnce(
      (cb: (tx: unknown) => Promise<unknown>) => cb(fullTx()),
    );
    await evaluateAlert(scheduledAt(1));

    expect(mocks.eventRows).toHaveLength(0);
    expect(mocks.instanceUpserts).toHaveLength(1);
    expect(mocks.instanceUpserts[0]).toMatchObject({
      status: "firing",
      value: 7,
      episodeId: firedEventId,
    });
    expect(
      mocks.scheduledJobs.some((job) => job.task === ALERT_PROCESS_EVENT_TASK),
    ).toBe(false);

    persistInstances();
    mocks.eventRows = [];
    mocks.scheduledJobs = [];
    mocks.definitionUpdates = [];

    // Resolve: the row drops out of the query result entirely.
    mocks.query.mockResolvedValueOnce({ rows: [] });
    mocks.transaction.mockImplementationOnce(
      (cb: (tx: unknown) => Promise<unknown>) => cb(fullTx()),
    );
    await evaluateAlert(scheduledAt(2));

    expect(mocks.eventRows).toHaveLength(1);
    expect(mocks.eventRows[0]).toMatchObject({
      eventType: "instance_resolved",
      kind: "notifying",
    });
    expect(mocks.instanceUpserts[0]).toMatchObject({
      status: "inactive",
      episodeId: null,
    });
    expect(mocks.definitionUpdates).toContainEqual(
      expect.objectContaining({
        currentState: "resolved",
        firingInstanceCount: 0,
      }),
    );
  });

  // The applied === false guard: a duplicate scheduledFor (already recorded)
  // must not write a second copy of anything.
  it("suppresses a stale evaluation instead of writing anything", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ service: "api", value: 5 }],
    });
    mocks.transaction.mockImplementationOnce(
      (cb: (tx: unknown) => Promise<unknown>) => cb(fullTx({ applies: false })),
    );

    await evaluateAlert(payload);

    expect(mocks.instanceUpserts).toEqual([]);
    expect(mocks.eventRows).toEqual([]);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("does not enqueue a process job for a state-kind pending transition", async () => {
    mocks.definition = {
      ...definition,
      spec: { ...definition.spec, for_secs: 300 },
    };
    mocks.query.mockResolvedValueOnce({
      rows: [{ service: "api", value: 5 }],
    });
    mocks.transaction.mockImplementationOnce(
      (cb: (tx: unknown) => Promise<unknown>) => cb(fullTx()),
    );

    await evaluateAlert(payload);

    expect(mocks.eventRows).toHaveLength(1);
    expect(mocks.eventRows[0]).toMatchObject({
      eventType: "instance_pending",
      kind: "state",
    });
    expect(
      mocks.scheduledJobs.some((job) => job.task === ALERT_PROCESS_EVENT_TASK),
    ).toBe(false);
    expect(
      mocks.scheduledJobs.some((job) => job.task === ALERT_EVALUATE_TASK),
    ).toBe(true);
  });
});
