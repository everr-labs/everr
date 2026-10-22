import { describe, expect, it, vi } from "vitest";

vi.mock("./billing-data.server", () => ({ readOrgEntitlement: vi.fn() }));

import { productPolicy } from "./app/policy";
import { readOrgEntitlement } from "./billing-data.server";

describe("cloud retention", () => {
  it.each([
    ["hobby", "hobby", 14, 14],
    ["pro", "pro", 365, 30],
    ["pro", "suspended", 365, 30],
  ] as const)("preserves %s retention with %s access", async (plan, appState, telemetryDays, evaluationDays) => {
    vi.mocked(readOrgEntitlement).mockResolvedValueOnce({
      plan,
      appState,
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    expect((await productPolicy.forOrganization("org")).retention).toEqual({
      tracesDays: telemetryDays,
      logsDays: telemetryDays,
      metricsDays: telemetryDays,
      alertEvaluationDays: evaluationDays,
      alertLifecycleDays: telemetryDays,
    });
  });
});
