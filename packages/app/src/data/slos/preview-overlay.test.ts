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

function slo(
  id: string,
  name: string,
  annotations: Record<string, string> = {},
  suppressed = false,
): CcSlo {
  return {
    id,
    tenant: "org1",
    name,
    spec: {
      ...BASE_SPEC,
      annotations,
      suppressed,
    },
    version: 1,
    paused: false,
  };
}

describe("visibleSlosForPreview", () => {
  it("hides preview copies in live mode", () => {
    const rows = visibleSlosForPreview(
      [
        slo("live", "checkout", {
          "everr.name": "checkout",
          "everr.repoid": "repo-1",
        }),
        slo(
          "preview",
          "checkout.pv-abc",
          {
            "everr.name": "checkout",
            "everr.repoid": "repo-1",
            "everr.preview": "p1",
          },
          true,
        ),
      ],
      null,
    );

    expect(rows.map((row) => row.id)).toEqual(["live"]);
  });

  it("replaces covered live SLOs with the active preview copy under the authored name", () => {
    const rows = visibleSlosForPreview(
      [
        slo("live", "checkout", {
          "everr.name": "checkout",
          "everr.repoid": "repo-1",
        }),
        slo(
          "preview",
          "checkout.pv-abc",
          {
            "everr.name": "checkout",
            "everr.repoid": "repo-1",
            "everr.preview": "p1",
          },
          true,
        ),
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
        slo("other-repo", "payments", {
          "everr.name": "payments",
          "everr.repoid": "repo-2",
        }),
        slo(
          "other-preview",
          "checkout.pv-other",
          {
            "everr.name": "checkout",
            "everr.repoid": "repo-1",
            "everr.preview": "p2",
          },
          true,
        ),
      ],
      [{ id: "p1", repoid: "repo-1" }],
    );

    expect(rows.map((row) => row.id)).toEqual(["engine", "other-repo"]);
  });

  it("hides covered live SLOs that are removed in preview", () => {
    const rows = visibleSlosForPreview(
      [
        slo("removed", "checkout", {
          "everr.name": "checkout",
          "everr.repoid": "repo-1",
        }),
      ],
      [{ id: "p1", repoid: "repo-1" }],
    );

    expect(rows).toEqual([]);
  });
});
