import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  steps: [] as string[],
}));

vi.mock("@/db/client", () => ({ db: {}, pool: {} }));
vi.mock("@/server/worker/jobs", () => ({
  addWorkerJobInTransaction: () => Promise.resolve(),
}));
vi.mock("./lifecycle.server", () => ({
  closeRuleLifecycle: (_tx: unknown, _def: unknown, reason: string) => {
    mocks.steps.push(`close:${reason}`);
    return Promise.resolve({ closedEventIds: [], suppressedEventIds: [] });
  },
}));

import { alertInstances } from "@/db/schema";
import { rollupAlertState, updateRule } from "./repository";

// The rollup must pass `pending` through: collapsing everything but firing to
// inactive makes the Pending state unreachable in every list and detail view.
describe("rollupAlertState", () => {
  it("covers inactive, pending, firing, and resolved", () => {
    expect(rollupAlertState("unknown")).toBe("inactive");
    expect(rollupAlertState("resolved")).toBe("inactive");
    expect(rollupAlertState("pending")).toBe("pending");
    expect(rollupAlertState("firing")).toBe("firing");
  });
});

const spec = {
  sql: "SELECT host, x AS value FROM t",
  interval_secs: 30,
  for_secs: 60,
  label_columns: ["host"],
  condition: { operator: "gt" as const, threshold: 1 },
  severity: "critical" as const,
  suppressed: false,
  annotations: {},
  resolve_after: 1,
};

const previous = {
  id: "6f1c9d20-3b7a-4c11-9f2e-8a5d4c3b2a10",
  organizationId: "org-1",
  repoid: "repo-1",
  previewId: null,
  project: "default",
  slug: "checkout-errors",
  spec,
  version: 1,
  active: true,
  nextEvaluationAt: null,
};

function fakeExecutor() {
  const tx = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ ...previous, version: 2, spec }]),
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        if (table === alertInstances) mocks.steps.push("delete:instances");
        return Promise.resolve();
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([previous]) }),
      }),
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Parameters<typeof updateRule>[4];
}

// The instances a label-columns change destroys must end like any other
// destruction: lifecycle closed first (terminals journaled, in-flight events
// canceled), then deleted. A bare delete leaves open episodes dangling forever.
describe("updateRule", () => {
  it("closes the lifecycle before deleting instances on a label change", async () => {
    mocks.steps = [];

    await updateRule(
      "org-1",
      previous.id,
      { ...spec, label_columns: ["host", "region"], notification_channels: [] },
      1,
      fakeExecutor(),
    );

    expect(mocks.steps).toEqual(["close:labels_changed", "delete:instances"]);
  });

  it("leaves instances alone when the label columns are unchanged", async () => {
    mocks.steps = [];

    await updateRule(
      "org-1",
      previous.id,
      { ...spec, notification_channels: [] },
      1,
      fakeExecutor(),
    );

    expect(mocks.steps).toEqual([]);
  });
});
