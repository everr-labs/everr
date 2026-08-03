import type { CcRuleView } from "@/data/cc/types";

// Imported from *.test files only; must never be imported from app code.

export type CcRuleViewOverrides = Partial<Omit<CcRuleView, "spec">> & {
  spec?: Partial<CcRuleView["spec"]>;
};

export function ccRuleViewFixture(
  overrides: CcRuleViewOverrides = {},
): CcRuleView {
  const { spec, ...rest } = overrides;
  return {
    id: "44444444-4444-4444-4444-444444444444",
    tenant: "org1",
    namespace: "",
    name: "default/flapping",
    spec: {
      sql: "SELECT 1",
      interval_secs: 60,
      for_secs: 0,
      label_columns: [],
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
    ...rest,
  };
}
