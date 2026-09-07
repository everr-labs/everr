import { alertingConditionValue } from "@/data/alerting/rules/condition";
import type { AlertingEvaluationSample } from "@/data/alerting/types";
import { rowsToInstances } from "./instances";

// A chart cannot make dozens of simultaneous label sets legible, and keeping
// every result row at every evaluation would grow high-cardinality history for
// no UI gain. Keep enough candidates for stable series selection, and bound
// each evaluation event.
export const ALERT_EVALUATION_SAMPLE_LIMIT = 64;

export function captureAlertEvaluationSamples(
  rows: readonly Record<string, unknown>[],
  instanceLabelColumns: readonly string[],
  matchingFingerprints: ReadonlySet<string>,
): { samples: AlertingEvaluationSample[]; truncated: boolean } {
  const instances = rowsToInstances(rows, instanceLabelColumns);
  // Matching instances first. A rule with more label sets than the sample
  // budget must not let healthy filler crowd out the breaching ones.
  // Downsampling guarantees a breach survives, but only if the breach reaches
  // the samples that feed it.
  const ordered = [
    ...instances.filter((instance) =>
      matchingFingerprints.has(instance.fingerprint),
    ),
    ...instances.filter(
      (instance) => !matchingFingerprints.has(instance.fingerprint),
    ),
  ];
  return {
    samples: ordered
      .slice(0, ALERT_EVALUATION_SAMPLE_LIMIT)
      .map((instance) => ({
        fingerprint: instance.fingerprint,
        labels: instance.labels,
        value: alertingConditionValue(instance.row),
      })),
    truncated: ordered.length > ALERT_EVALUATION_SAMPLE_LIMIT,
  };
}
