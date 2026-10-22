import type { ProductPolicy } from "#app/composition/policy.ts";
import { appEnv as env } from "./env";

export const productPolicy: ProductPolicy = {
  async forOrganization() {
    return {
      access: "enabled",
      canInviteMembers: true,
      retention: {
        tracesDays: env.EVERR_RETENTION_TRACES_DAYS ?? env.EVERR_RETENTION_DAYS,
        logsDays: env.EVERR_RETENTION_LOGS_DAYS ?? env.EVERR_RETENTION_DAYS,
        metricsDays:
          env.EVERR_RETENTION_METRICS_DAYS ?? env.EVERR_RETENTION_DAYS,
        alertEvaluationDays:
          env.EVERR_RETENTION_ALERT_EVALUATIONS_DAYS ??
          env.EVERR_RETENTION_DAYS,
        alertLifecycleDays:
          env.EVERR_RETENTION_ALERT_LIFECYCLE_DAYS ?? env.EVERR_RETENTION_DAYS,
      },
    };
  },
};
