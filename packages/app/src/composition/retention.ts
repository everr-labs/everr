export type TenantRetention = Readonly<{
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
  profilesDays: number;
  alertEvaluationDays: number;
  alertLifecycleDays: number;
}>;
