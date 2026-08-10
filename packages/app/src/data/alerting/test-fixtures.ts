import type { AlertingRuleView } from "@/data/alerting/types";

// Imported from *.test files only; must never be imported from app code.

export type AlertingRuleViewOverrides = Partial<
  Omit<AlertingRuleView, "spec">
> & {
  spec?: Partial<AlertingRuleView["spec"]>;
};

export function alertingRuleViewFixture(
  overrides: AlertingRuleViewOverrides = {},
): AlertingRuleView {
  const { spec, ...rest } = overrides;
  return {
    id: "44444444-4444-4444-4444-444444444444",
    tenant: "org1",
    repoid: "repo-1",
    previewId: null,
    name: "default/flapping",
    notification_channels: [],
    spec: {
      sql: "SELECT 1",
      interval_secs: 60,
      for_secs: 0,
      label_columns: [],
      condition: { operator: "gt", threshold: 0 },
      severity: "critical",
      annotations: {},
      resolve_after: 1,
      suppressed: false,
      ...spec,
    },
    version: 1,
    paused: false,
    updated_at: "2026-06-14T12:00:00Z",
    health: {
      status: "healthy",
      consecutive_failures: 0,
      degraded_since: null,
      last_error: null,
      last_error_at: null,
    },
    rollup: {
      alert_state: "inactive",
      firing_instance_count: 0,
      last_fired_at: null,
      last_resolved_at: null,
      last_seen_at: null,
      next_evaluation_at: "2026-06-14T12:01:00Z",
      last_row_count: 0,
    },
    ...rest,
  };
}
