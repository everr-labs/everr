import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/cc/client", () => ({
  listRules: vi.fn(),
  deleteRule: vi.fn(),
}));

// The sweep's production db path pulls in @/db/client, which reads server-only
// env at import; the tests drive the sweep through an injected fake instead, so
// a stub keeps the real client (and its env access) out of the jsdom runner.
vi.mock("@/db/client", () => ({ db: {} }));

// The logger emits via the OTel API; keep it inert and assertable.
vi.mock("@/telemetry/logger", () => ({
  serverLogger: { error: vi.fn(), info: vi.fn() },
  errorMessage: (reason: unknown) =>
    reason instanceof Error ? reason.message : String(reason),
}));

import * as cc from "@/data/cc/client";
import { serverLogger } from "@/telemetry/logger";
import { OWN_PREVIEW, OWN_REPO } from "./mapping";
import {
  deletePreviewCcRules,
  type OrphanSweepDb,
  sweepOrphanCcRules,
} from "./preview-cleanup.server";

const mockedListRules = cc.listRules as ReturnType<typeof vi.fn>;
const mockedDeleteRule = cc.deleteRule as ReturnType<typeof vi.fn>;

function ccRule(id: string, previewId?: string) {
  return {
    id,
    spec: {
      annotations: {
        [OWN_REPO]: "repo-1",
        ...(previewId ? { [OWN_PREVIEW]: previewId } : {}),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDeleteRule.mockResolvedValue({ deleted: true });
});

describe("deletePreviewCcRules", () => {
  it("deletes only the rules tagged with a deleted preview id, per org", async () => {
    mockedListRules.mockImplementation(async (orgId: string) =>
      orgId === "org-a"
        ? [ccRule("live"), ccRule("a1", "p1"), ccRule("other", "p9")]
        : [ccRule("b1", "p2")],
    );

    await deletePreviewCcRules([
      { id: "p1", organizationId: "org-a" },
      { id: "p2", organizationId: "org-b" },
    ]);

    // One listing per affected org, deletions scoped to the deleted ids:
    // live rules and other previews' rules survive.
    expect(mockedListRules).toHaveBeenCalledTimes(2);
    expect(mockedDeleteRule.mock.calls).toEqual([
      ["org-a", "a1"],
      ["org-b", "b1"],
    ]);
  });

  it("groups multiple deleted previews of one org into a single listing", async () => {
    mockedListRules.mockResolvedValue([ccRule("a1", "p1"), ccRule("a2", "p2")]);

    await deletePreviewCcRules([
      { id: "p1", organizationId: "org-a" },
      { id: "p2", organizationId: "org-a" },
    ]);

    expect(mockedListRules).toHaveBeenCalledTimes(1);
    expect(mockedDeleteRule).toHaveBeenCalledTimes(2);
  });

  it("logs and moves on when CC is unreachable for one org", async () => {
    mockedListRules.mockImplementation(async (orgId: string) => {
      if (orgId === "org-a") throw new Error("cc down");
      return [ccRule("b1", "p2")];
    });

    // Never throws: the preview rows are already gone and retention must not
    // fail on a CC outage — the orphaned suppressed rules are only logged.
    await deletePreviewCcRules([
      { id: "p1", organizationId: "org-a" },
      { id: "p2", organizationId: "org-b" },
    ]);

    expect(serverLogger.error).toHaveBeenCalledWith(
      "previews.cc_cleanup.failed",
      expect.objectContaining({
        "organization.id": "org-a",
        "error.message": "cc down",
      }),
    );
    // The other org's cleanup still ran.
    expect(mockedDeleteRule).toHaveBeenCalledWith("org-b", "b1");
  });
});

/**
 * A fake registry: `orgs` are the orgs to sweep; `existing` is the set of
 * preview ids that still have a registry row. `existingPreviewIds` records the
 * order of its calls relative to `listRules` so a test can assert the race
 * guard (list before snapshot).
 */
function fakeSweepDb(
  orgs: string[],
  existing: Set<string>,
  onSnapshot?: (orgId: string) => void,
): OrphanSweepDb {
  return {
    listPreviewOrgs: async () => orgs,
    existingPreviewIds: async (orgId, ids) => {
      onSnapshot?.(orgId);
      return new Set([...ids].filter((id) => existing.has(id)));
    },
  };
}

describe("sweepOrphanCcRules", () => {
  it("deletes preview rules whose annotation id is absent from the registry", async () => {
    mockedListRules.mockResolvedValue([
      ccRule("live"), // no preview annotation → never touched
      ccRule("keep", "p-live"), // registry row still exists → kept
      ccRule("orphan1", "p-gone"), // no registry row → orphan
      ccRule("orphan2", "p-gone2"),
    ]);
    const db = fakeSweepDb(["org-a"], new Set(["p-live"]));

    await sweepOrphanCcRules(db);

    expect(mockedDeleteRule.mock.calls).toEqual([
      ["org-a", "orphan1"],
      ["org-a", "orphan2"],
    ]);
  });

  it("keeps a preview created between the list and the registry snapshot (race guard)", async () => {
    // The rule is listed while its preview looks gone, but the registry
    // snapshot (read AFTER the list) shows the row present → retained.
    const calls: string[] = [];
    mockedListRules.mockImplementation(async (orgId: string) => {
      calls.push(`list:${orgId}`);
      return [ccRule("racy", "p-racy")];
    });
    const db = fakeSweepDb(["org-a"], new Set(["p-racy"]), (orgId) =>
      calls.push(`snapshot:${orgId}`),
    );

    await sweepOrphanCcRules(db);

    // Snapshot happened strictly after the list, and nothing was deleted.
    expect(calls).toEqual(["list:org-a", "snapshot:org-a"]);
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });

  it("caps deletions per org and flags the run as capped", async () => {
    const rules = Array.from({ length: 150 }, (_, i) =>
      ccRule(`orphan-${i}`, `p-${i}`),
    );
    mockedListRules.mockResolvedValue(rules);
    const db = fakeSweepDb(["org-a"], new Set());

    await sweepOrphanCcRules(db);

    expect(mockedDeleteRule).toHaveBeenCalledTimes(100);
    expect(serverLogger.info).toHaveBeenCalledWith(
      "previews.cc_orphan_sweep.swept",
      expect.objectContaining({
        "organization.id": "org-a",
        "previews.orphan_rules_deleted": 100,
        "previews.orphan_sweep_capped": true,
      }),
    );
  });

  it("logs and continues to the next org when CC is unreachable for one", async () => {
    mockedListRules.mockImplementation(async (orgId: string) => {
      if (orgId === "org-a") throw new Error("cc down");
      return [ccRule("orphan", "p-gone")];
    });
    const db = fakeSweepDb(["org-a", "org-b"], new Set());

    let threw = false;
    try {
      await sweepOrphanCcRules(db);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    expect(serverLogger.error).toHaveBeenCalledWith(
      "previews.cc_orphan_sweep.failed",
      expect.objectContaining({
        "organization.id": "org-a",
        "error.message": "cc down",
      }),
    );
    // The healthy org was still swept.
    expect(mockedDeleteRule).toHaveBeenCalledWith("org-b", "orphan");
  });

  it("does not read the registry or delete when an org has no preview rules", async () => {
    mockedListRules.mockResolvedValue([ccRule("live")]);
    const snapshots: string[] = [];
    const db = fakeSweepDb(["org-a"], new Set(), (orgId) =>
      snapshots.push(orgId),
    );

    await sweepOrphanCcRules(db);

    expect(snapshots).toEqual([]);
    expect(mockedDeleteRule).not.toHaveBeenCalled();
  });
});
