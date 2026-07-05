import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  listRules: vi.fn(),
  createRule: vi.fn(),
  deleteRule: vi.fn(),
  listReceivers: vi.fn(),
  upsertReceiver: vi.fn(),
  deleteReceiver: vi.fn(),
}));

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
          for: "0s",
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

it("upserts receivers and never prunes (CC receivers have no ownership)", async () => {
  (client.listReceivers as ReturnType<typeof vi.fn>).mockResolvedValue([
    { name: "keep" },
    { name: "other" },
  ]);
  const res = await applyCcReceiverSpecs({
    namespace: { orgId: "o", repoid: "repo1", kind: "live" },
    db,
    resources: [
      entry({
        kind: "CCReceiver",
        metadata: { name: "keep" },
        spec: { channel: { type: "slack", url: "u" } },
      }),
    ],
  });
  expect(res.updated).toContain("keep");
  // Non-destructive: a receiver absent from config ("other") is NOT deleted.
  expect(client.deleteReceiver).not.toHaveBeenCalled();
  expect(res.deleted).toEqual([]);
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
});
