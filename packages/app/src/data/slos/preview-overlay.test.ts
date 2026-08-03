import { describe, expect, it } from "vitest";
import type { CcSlo } from "@/data/cc/types";
import { visibleSlosForPreview } from "./preview-overlay";

const BASE_SPEC: CcSlo["spec"] = {
  sli: {
    sql: "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
    label_columns: [],
  },
  targetPercent: 99.9,
  timeWindow: { duration: "30d", isRolling: true },
  annotations: {},
  suppressed: false,
};

// Preview identity now rides on the SLO's first-class `namespace` ("" = live,
// a preview id otherwise) with `name` shared verbatim between a live SLO and
// its preview copy, instead of the retired `everr.name`/`everr.preview`
// annotations.
function slo(
  id: string,
  name: string,
  opts: { repoid?: string; namespace?: string; suppressed?: boolean } = {},
): CcSlo {
  return {
    id,
    tenant: "org1",
    namespace: opts.namespace ?? "",
    name,
    spec: {
      ...BASE_SPEC,
      annotations:
        opts.repoid !== undefined ? { "everr.repoid": opts.repoid } : {},
      suppressed: opts.suppressed ?? false,
    },
    version: 1,
    paused: false,
  };
}

describe("visibleSlosForPreview", () => {
  it("hides preview copies in live mode", () => {
    const rows = visibleSlosForPreview(
      [
        slo("live", "checkout", { repoid: "repo-1" }),
        slo("preview", "checkout", {
          repoid: "repo-1",
          namespace: "p1",
          suppressed: true,
        }),
      ],
      null,
    );

    expect(rows.map((row) => row.id)).toEqual(["live"]);
  });

  it("replaces covered live SLOs with the active preview copy under the authored name", () => {
    const rows = visibleSlosForPreview(
      [
        slo("live", "checkout", { repoid: "repo-1" }),
        slo("preview", "checkout", {
          repoid: "repo-1",
          namespace: "p1",
          suppressed: true,
        }),
      ],
      [{ id: "p1", repoid: "repo-1" }],
    );

    expect(rows.map((row) => [row.id, row.name, row.spec.suppressed])).toEqual([
      ["preview", "checkout", true],
    ]);
  });

  it("keeps unmanaged and uncovered live SLOs while hiding unrelated previews", () => {
    const rows = visibleSlosForPreview(
      [
        slo("engine", "manual"),
        slo("other-repo", "payments", { repoid: "repo-2" }),
        slo("other-preview", "checkout", {
          repoid: "repo-1",
          namespace: "p2",
          suppressed: true,
        }),
      ],
      [{ id: "p1", repoid: "repo-1" }],
    );

    expect(rows.map((row) => row.id)).toEqual(["engine", "other-repo"]);
  });

  it("hides covered live SLOs that are removed in preview", () => {
    const rows = visibleSlosForPreview(
      [slo("removed", "checkout", { repoid: "repo-1" })],
      [{ id: "p1", repoid: "repo-1" }],
    );

    expect(rows).toEqual([]);
  });
});
