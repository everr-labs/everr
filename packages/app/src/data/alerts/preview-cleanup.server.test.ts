import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/cc/client", () => ({
  listRules: vi.fn(),
  deleteRule: vi.fn(),
}));

// The logger emits via the OTel API; keep it inert and assertable.
vi.mock("@/telemetry/logger", () => ({
  serverLogger: { error: vi.fn() },
  errorMessage: (reason: unknown) =>
    reason instanceof Error ? reason.message : String(reason),
}));

import * as cc from "@/data/cc/client";
import { serverLogger } from "@/telemetry/logger";
import { MANAGED_SIMPLE, OWN_MANAGED, OWN_PREVIEW, OWN_REPO } from "./mapping";
import { deletePreviewCcRules } from "./preview-cleanup.server";

const mockedListRules = cc.listRules as ReturnType<typeof vi.fn>;
const mockedDeleteRule = cc.deleteRule as ReturnType<typeof vi.fn>;

function ccRule(id: string, previewId?: string) {
  return {
    id,
    spec: {
      annotations: {
        [OWN_REPO]: "repo-1",
        [OWN_MANAGED]: MANAGED_SIMPLE,
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
