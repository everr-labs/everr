import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  listRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  listReceivers: vi.fn(),
  upsertReceiver: vi.fn(),
  deleteReceiver: vi.fn(),
  listRoutes: vi.fn(),
}));

import { ApplyValidationError } from "@/data/as-code/errors";
import type { DbExecutor } from "@/db/client";
import { applyCcReceiverSpecs, applyCcRuleSpecs } from "./apply.server";
import * as client from "./client";

// The CC reconcilers talk to CC over HTTP and never touch Postgres, so the
// Reconciler contract's `db` is unused here — a stub satisfies the type.
const db = {} as unknown as DbExecutor;

beforeEach(() => {
  vi.clearAllMocks();
});

const entry = (resource: unknown) => ({ path: "r.yaml", resource });

it("creates a rule that is in config but absent in CC", async () => {
  (client.listRules as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (client.createRule as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "new",
  });
  const res = await applyCcRuleSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [
      entry({
        kind: "CCAlertRule",
        metadata: { name: "r1" },
        spec: {
          sql: "SELECT 1",
          evaluationInterval: "30s",
          for: "1d",
          labelColumns: ["h"],
          valueColumn: "v",
          severity: "info",
          resolveAfter: 1,
        },
      }),
    ],
  });
  expect(res.created).toEqual(["r1"]);
  const arg = (client.createRule as ReturnType<typeof vi.fn>).mock.calls[0][1];
  expect(arg.annotations["everr.name"]).toBe("r1");
  expect(arg.annotations["everr.repoid"]).toBe("repo1");
  expect(arg.interval_secs).toBe(30);
  // Durations support the day unit, like the simple AlertRule fields.
  expect(arg.for_secs).toBe(86400);
});

it("updates a changed rule in place with its version (no delete+recreate)", async () => {
  (client.listRules as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "r1",
      version: 5,
      spec: {
        sql: "SELECT 2",
        interval_secs: 30,
        for_secs: 0,
        label_columns: [],
        value_column: null,
        severity: "info",
        annotations: { "everr.name": "r1", "everr.repoid": "repo1" },
        resolve_after: 1,
      },
    },
  ]);
  const res = await applyCcRuleSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [
      entry({
        kind: "CCAlertRule",
        metadata: { name: "r1" },
        spec: {
          sql: "SELECT 1",
          evaluationInterval: "30s",
          severity: "info",
        },
      }),
    ],
  });
  expect(res.updated).toEqual(["r1"]);
  expect(client.updateRule).toHaveBeenCalledTimes(1);
  const [org, id, spec, version] = (
    client.updateRule as ReturnType<typeof vi.fn>
  ).mock.calls[0];
  expect(org).toBe("o");
  expect(id).toBe("r1");
  expect(spec.sql).toBe("SELECT 1");
  expect(version).toBe(5);
  expect(client.deleteRule).not.toHaveBeenCalled();
  expect(client.createRule).not.toHaveBeenCalled();
});

it("fails the resource clearly when CC reports a version conflict", async () => {
  (client.listRules as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "r1",
      version: 5,
      spec: {
        sql: "SELECT 2",
        interval_secs: 30,
        for_secs: 0,
        label_columns: [],
        value_column: null,
        severity: "info",
        annotations: { "everr.name": "r1", "everr.repoid": "repo1" },
        resolve_after: 1,
      },
    },
  ]);
  (client.updateRule as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    Object.assign(new Error("rule version mismatch: expected 5, current 6"), {
      name: "CcApiError",
      status: 409,
    }),
  );
  try {
    await applyCcRuleSpecs({
      namespace: { orgId: "o", repoid: "repo1", kind: "live" },
      db,
      resources: [
        entry({
          kind: "CCAlertRule",
          metadata: { name: "r1" },
          spec: {
            sql: "SELECT 1",
            evaluationInterval: "30s",
            severity: "info",
          },
        }),
      ],
    });
    expect.fail("expected the version conflict to fail the apply");
  } catch (error) {
    expect(error).toBeInstanceOf(ApplyValidationError);
    expect(error).toMatchObject({
      message: expect.stringMatching(
        /r\.yaml: rule "r1" was modified concurrently .* re-run apply/,
      ),
    });
  }
});

it("deletes a CC rule owned by repoid but absent from config", async () => {
  (client.listRules as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "x",
      spec: { annotations: { "everr.name": "old", "everr.repoid": "repo1" } },
    },
  ]);
  const res = await applyCcRuleSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [],
  });
  expect(client.deleteRule).toHaveBeenCalledWith("o", "x");
  expect(res.deleted).toEqual(["old"]);
});

it("ignores rules owned by a different repoid", async () => {
  (client.listRules as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "y",
      spec: { annotations: { "everr.name": "other", "everr.repoid": "repo2" } },
    },
  ]);
  const res = await applyCcRuleSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [],
  });
  expect(client.deleteRule).not.toHaveBeenCalled();
  expect(res.deleted).toEqual([]);
});

it("dryRun plans without calling mutating client methods", async () => {
  (client.listRules as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const res = await applyCcRuleSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    dryRun: true,
    resources: [
      entry({
        kind: "CCAlertRule",
        metadata: { name: "r1" },
        spec: {
          sql: "SELECT 1",
          evaluationInterval: "30s",
          for: "0s",
          labelColumns: [],
          severity: "info",
        },
      }),
    ],
  });
  expect(res.created).toEqual(["r1"]);
  expect(client.createRule).not.toHaveBeenCalled();
});

const receiverEntry = (name: string) =>
  entry({
    kind: "CCReceiver",
    metadata: { name },
    spec: { channel: { type: "slack", url: "u" } },
  });

it("stamps repoid + as-code ownership on every receiver upsert", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "keep",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [receiverEntry("keep"), receiverEntry("fresh")],
  });
  expect(res.updated).toEqual(["keep"]);
  expect(res.created).toEqual(["fresh"]);
  const bodies = (client.upsertReceiver as ReturnType<typeof vi.fn>).mock.calls;
  for (const [, body] of bodies) {
    expect(body.annotations).toEqual({
      "everr.repoid": "repo1",
      "everr.managed": "as-code",
    });
  }
});

it("prunes an as-code receiver of this repo that config no longer declares", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "keep",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
    {
      name: "gone",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  (client.listRoutes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [receiverEntry("keep")],
  });
  expect(client.deleteReceiver).toHaveBeenCalledWith("o", "gone");
  expect(client.deleteReceiver).toHaveBeenCalledTimes(1);
  expect(res.deleted).toEqual(["gone"]);
});

it("never prunes unmarked receivers, other repos', or the org defaults", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    // No ownership marker (created out-of-band / by an older apply).
    { name: "unmarked" },
    // Owned by a different repo.
    {
      name: "other-repo",
      annotations: { "everr.repoid": "repo2", "everr.managed": "as-code" },
    },
    // Settings-owned org default — even if hand-stamped, name-guarded.
    {
      name: "everr-default-slack",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  (client.listRoutes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [],
  });
  expect(client.deleteReceiver).not.toHaveBeenCalled();
  expect(res.deleted).toEqual([]);
});

it("fails (naming the route ids) instead of deleting a route-referenced receiver", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "gone",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  (client.listRoutes as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "route-a", receiver: "gone" },
    { id: "route-b", receiver: "gone" },
    { id: "route-c", receiver: "someone-else" },
  ]);
  try {
    await applyCcReceiverSpecs({
      namespace: { orgId: "o", repoid: "repo1", kind: "live" },
      db,
      resources: [],
    });
    expect.fail("expected the route reference to fail the apply");
  } catch (error) {
    expect(error).toBeInstanceOf(ApplyValidationError);
    expect((error as Error).message).toMatch(/route-a/);
    expect((error as Error).message).toMatch(/route-b/);
    expect((error as Error).message).toContain('"gone"');
  }
  expect(client.deleteReceiver).not.toHaveBeenCalled();
});

it("dryRun reports would-be receiver deletions without deleting or upserting", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "keep",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
    {
      name: "gone",
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    },
  ]);
  (client.listRoutes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    dryRun: true,
    resources: [receiverEntry("keep")],
  });
  expect(res.deleted).toEqual(["gone"]);
  expect(res.updated).toEqual(["keep"]);
  expect(client.deleteReceiver).not.toHaveBeenCalled();
  expect(client.upsertReceiver).not.toHaveBeenCalled();
});

// Job-2 regression: a repo with BOTH a simple-managed AlertRule and a
// power-user CCAlertRule. The CCAlertRule reconciler must scope past the
// simple rule (everr.managed = "simple") and never delete or adopt it.
it("CCAlertRule apply leaves this repo's simple-managed rules untouched", async () => {
  (client.listRules as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "cc-id",
      version: 1,
      spec: {
        sql: "SELECT 1",
        interval_secs: 30,
        for_secs: 0,
        label_columns: [],
        value_column: null,
        severity: "info",
        annotations: { "everr.name": "cc1", "everr.repoid": "repo1" },
        resolve_after: 1,
      },
    },
    {
      id: "simple-id",
      version: 1,
      spec: {
        sql: "SELECT simple",
        interval_secs: 60,
        for_secs: 0,
        label_columns: [],
        value_column: null,
        severity: "warning",
        annotations: {
          "everr.name": "simple1",
          "everr.repoid": "repo1",
          "everr.managed": "simple",
        },
        resolve_after: 1,
      },
    },
  ]);
  const res = await applyCcRuleSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [
      entry({
        kind: "CCAlertRule",
        metadata: { name: "cc1" },
        spec: {
          sql: "SELECT 1",
          evaluationInterval: "30s",
          for: "0s",
          labelColumns: [],
          valueColumn: null,
          severity: "info",
          resolveAfter: 1,
        },
      }),
    ],
  });
  // The simple rule is out of scope: not deleted, not touched at all.
  expect(client.deleteRule).not.toHaveBeenCalled();
  expect(res.deleted).toEqual([]);
  // The CCAlertRule matched its stored spec, so no churn.
  expect(res.updated).toEqual([]);
  expect(res.created).toEqual([]);
});

it("does not delete+recreate a rule when only annotation key ORDER differs", async () => {
  // Same logical spec; CC returns annotations in a different key order than the
  // YAML source. Fingerprint must be order-insensitive → treated as unchanged.
  (client.listRules as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "r1",
      spec: {
        sql: "SELECT 1",
        interval_secs: 30,
        for_secs: 0,
        label_columns: [],
        value_column: null,
        severity: "info",
        annotations: {
          beta: "2",
          alpha: "1",
          "everr.name": "r1",
          "everr.repoid": "repo1",
        },
        resolve_after: 1,
      },
    },
  ]);
  const res = await applyCcRuleSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [
      entry({
        kind: "CCAlertRule",
        metadata: { name: "r1" },
        spec: {
          sql: "SELECT 1",
          evaluationInterval: "30s",
          for: "0s",
          labelColumns: [],
          valueColumn: null,
          severity: "info",
          annotations: { alpha: "1", beta: "2" },
          resolveAfter: 1,
        },
      }),
    ],
  });
  expect(res.updated).toEqual([]);
  expect(res.created).toEqual([]);
  expect(client.deleteRule).not.toHaveBeenCalled();
  expect(client.createRule).not.toHaveBeenCalled();
  expect(client.updateRule).not.toHaveBeenCalled();
});
