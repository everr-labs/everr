export type TenantRetention = Readonly<{
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
  alertEvaluationDays: number;
  alertLifecycleDays: number;
}>;
