import { describe, expect, it } from "vitest";
import type { AlertingSlo } from "@/data/alerting/types";
import { visibleSlosForPreview } from "./preview-overlay";

const BASE_SPEC: AlertingSlo["spec"] = {
  sli: {
    sql: "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
  },
  targetPercent: 99.9,
  timeWindow: { duration: "30d", isRolling: true },
  annotations: {},
  suppressed: false,
};

// Preview ownership is explicit, with `name` shared verbatim between a live
// SLO and its preview copy.
function slo(
  id: string,
  name: string,
  opts: { repoid?: string; previewId?: string; suppressed?: boolean } = {},
): AlertingSlo {
  const canonicalName = name.includes("/") ? name : `default/${name}`;
  return {
    id,
    tenant: "org1",
    repoid: opts.repoid ?? "repo-1",
    previewId: opts.previewId ?? null,
    name: canonicalName,
    spec: {
      ...BASE_SPEC,
      annotations: {},
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
          previewId: "p1",
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
          previewId: "p1",
          suppressed: true,
        }),
      ],
      [{ id: "p1", repoid: "repo-1" }],
    );

    expect(rows.map((row) => [row.id, row.name, row.spec.suppressed])).toEqual([
      ["preview", "default/checkout", true],
    ]);
  });

  it("keeps uncovered live SLOs while hiding unrelated previews", () => {
    const rows = visibleSlosForPreview(
      [
        slo("engine", "manual", { repoid: "repo-ui" }),
        slo("other-repo", "payments", { repoid: "repo-2" }),
        slo("other-preview", "checkout", {
          repoid: "repo-1",
          previewId: "p2",
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
