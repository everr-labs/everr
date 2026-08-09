import { QueryBuilder } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobs: [] as { task: string; payload: unknown }[],
}));

vi.mock("@/db/client", () => ({ db: {}, pool: {} }));
vi.mock("@/server/worker/jobs", () => ({
  addWorkerJobInTransaction: (_tx: unknown, task: string, payload: unknown) => {
    mocks.jobs.push({ task, payload });
    return Promise.resolve();
  },
}));

import type { Transaction } from "@/db/client";
import { alertEvents } from "@/db/schema";
import { ALERT_PROJECT_LIFECYCLE_TASK } from "@/server/alerts/history/tasks";
import {
  cancelableNotifyingEventsFilter,
  closeRuleLifecycle,
  instanceClosedJournalRow,
} from "./lifecycle.server";

const def = {
  id: "6f1c9d20-3b7a-4c11-9f2e-8a5d4c3b2a10",
  organizationId: "org-1",
  repoid: "host/owner/repo",
  previewId: null,
  project: "default",
  slug: "high-5xx",
  spec: {
    severity: "critical",
    suppressed: false,
    annotations: {},
  },
} as unknown as Parameters<typeof instanceClosedJournalRow>[0];

const openInstance = {
  fingerprint: "api",
  labels: { service: "api" },
  episodeId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
};

const at = new Date("2026-08-09T10:00:00Z");

describe("instanceClosedJournalRow", () => {
  it("is born processed, state kind, and carries reason and episode", () => {
    const row = instanceClosedJournalRow(def, openInstance, "rule_paused", at);
    expect(row).toMatchObject({
      eventType: "instance_closed",
      kind: "state",
      reason: "rule_paused",
      episodeId: openInstance.episodeId,
      instanceFingerprint: "api",
      slug: "default/high-5xx",
      occurredAt: at,
      processedAt: at,
      suppressed: false,
    });
  });

  it("marks preview copies muted", () => {
    const row = instanceClosedJournalRow(
      { ...def, previewId: "0f1c9d20-3b7a-4c11-9f2e-8a5d4c3b2a10" },
      openInstance,
      "rule_deleted",
      at,
    );
    expect(row.suppressed).toBe(true);
  });
});

/** Records what the lifecycle close writes, without a database behind it. */
function recordingTx(state: {
  openInstances: unknown[];
  canceledIds: string[];
  insertedJournalRows: unknown[][];
  eventUpdates: Record<string, unknown>[];
}) {
  return {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(state.openInstances) }),
    }),
    insert: () => ({
      values: (rows: unknown[]) => {
        state.insertedJournalRows.push(rows);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            state.eventUpdates.push(values);
            return Promise.resolve(state.canceledIds.map((id) => ({ id })));
          },
        }),
      }),
    }),
  } as unknown as Transaction;
}

describe("closeRuleLifecycle", () => {
  beforeEach(() => {
    mocks.jobs = [];
  });

  it("journals one terminal per open instance, cancels in-flight events, and enqueues the projection", async () => {
    const state = {
      openInstances: [openInstance, { ...openInstance, fingerprint: "web" }],
      canceledIds: ["11111111-1111-7111-8111-111111111111"],
      insertedJournalRows: [] as unknown[][],
      eventUpdates: [] as Record<string, unknown>[],
    };

    const result = await closeRuleLifecycle(
      recordingTx(state),
      def,
      "rule_paused",
      at,
    );

    expect(state.insertedJournalRows).toHaveLength(1);
    expect(state.insertedJournalRows[0]).toHaveLength(2);
    expect(state.eventUpdates).toContainEqual({ processedAt: at });
    expect(result.closedEventIds).toHaveLength(2);
    expect(result.suppressedEventIds).toEqual(state.canceledIds);
    expect(mocks.jobs).toEqual([
      {
        task: ALERT_PROJECT_LIFECYCLE_TASK,
        payload: {
          closedEventIds: result.closedEventIds,
          suppressedEventIds: result.suppressedEventIds,
          reason: "rule_paused",
        },
      },
    ]);
  });

  // The recording tx above cannot see predicates, so the cancel's WHERE is
  // pinned on real rendered SQL: without every one of these four conditions
  // the update cancels another tenant's, another rule's, a state-kind, or an
  // already-claimed event.
  it("cancels only the rule's own unclaimed notifying events", () => {
    const { sql, params } = new QueryBuilder()
      .select()
      .from(alertEvents)
      .where(cancelableNotifyingEventsFilter(def))
      .toSQL();

    expect(sql).toContain('"organization_id" = ');
    expect(sql).toContain('"source_definition_id" = ');
    expect(sql).toContain('"kind" = ');
    expect(sql).toContain('"processed_at" is null');
    expect(params).toEqual([def.organizationId, def.id, "notifying"]);
  });

  it("enqueues nothing when the rule has no open instances and no in-flight events", async () => {
    const state = {
      openInstances: [],
      canceledIds: [],
      insertedJournalRows: [] as unknown[][],
      eventUpdates: [] as Record<string, unknown>[],
    };

    const result = await closeRuleLifecycle(
      recordingTx(state),
      def,
      "rule_deleted",
      at,
    );

    expect(result).toEqual({ closedEventIds: [], suppressedEventIds: [] });
    expect(state.insertedJournalRows).toEqual([]);
    expect(mocks.jobs).toEqual([]);
  });
});
