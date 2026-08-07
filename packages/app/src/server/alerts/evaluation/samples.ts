import { alertingConditionValue } from "@/data/alerting/rules/condition";
import type { AlertingEvaluationSample } from "@/data/alerting/types";
import { rowsToInstances } from "./instances";

// A chart cannot make dozens of simultaneous label sets legible, and retaining
// every result row at every evaluation would let a high-cardinality rule grow
// Postgres without a useful UI payoff. Keep enough candidates for stable series
// selection while bounding each evaluation row's JSON payload.
export const ALERT_EVALUATION_SAMPLE_LIMIT = 64;

export function captureAlertEvaluationSamples(
  rows: readonly Record<string, unknown>[],
  instanceLabelColumns: readonly string[],
): { samples: AlertingEvaluationSample[]; truncated: boolean } {
  const instances = rowsToInstances(rows, instanceLabelColumns, new Date(0));
  return {
    samples: instances
      .slice(0, ALERT_EVALUATION_SAMPLE_LIMIT)
      .map((instance) => ({
        fingerprint: instance.fingerprint,
        labels: instance.labels,
        value: alertingConditionValue(instance.row),
      })),
    truncated: instances.length > ALERT_EVALUATION_SAMPLE_LIMIT,
  };
}
