import type { TenantRetention } from "../composition/retention";

export function retentionForDays(
  telemetryDays: number,
  evaluationDays = telemetryDays,
  lifecycleDays = telemetryDays,
): TenantRetention {
  return {
    tracesDays: telemetryDays,
    logsDays: telemetryDays,
    metricsDays: telemetryDays,
    profilesDays: telemetryDays,
    alertEvaluationDays: evaluationDays,
    alertLifecycleDays: lifecycleDays,
  };
}
