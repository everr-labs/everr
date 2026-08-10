import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  definition: null as unknown,
  query: vi.fn(),
  transaction: vi.fn(),
  definitionUpdates: [] as Record<string, unknown>[],
  scheduledJobs: [] as { task: string; payload: unknown }[],
  history: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        // The two reads differ in shape: the definition lookup ends in
        // .limit(1), the instance lookup awaits .where() directly.
        where: () =>
          Object.assign(Promise.resolve([] as unknown[]), {
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
import { evaluateAlert, transitionEventRows } from "./rule";
import type { AlertInstanceTransition } from "./state-machine";

/** Records what the failure path writes, without a database behind it. */
function recordingTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ for: () => ({ limit: () => Promise.resolve([]) }) }),
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
    resolve_after: 0,
    label_columns: [],
    condition: { column: "value", op: "gt", value: 0 },
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
    mocks.definitionUpdates = [];
    mocks.scheduledJobs = [];
    mocks.query.mockReset();
    mocks.transaction.mockReset();
    mocks.history.mockReset().mockResolvedValue(undefined);
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
    event: "firing" | "resolved" | null,
  ): AlertInstanceTransition {
    return {
      next: {
        fingerprint: "api",
        status: event === "firing" ? "firing" : "inactive",
        labels: { service: "api" },
        evidence: { value: 1 },
        value: 1,
        pendingSince: null,
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
});
