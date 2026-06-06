export type FailedJobInfo = {
  jobName: string;
  stepNumber: string;
  stepName?: string;
};

export type FailureNotification = {
  dedupeKey: string;
  traceId: string;
  repo: string;
  branch: string;
  workflowName: string;
  failedAt: string;
  detailsUrl: string;
  failedJobs: FailedJobInfo[];
};

export type DesktopFailureNotification = FailureNotification & {
  kind: "workflow";
};

export type DesktopAlertNotification = {
  kind: "alert";
  dedupeKey: string;
  alertDefinitionId: number;
  alertEventId: number;
  service: string;
  name: string;
  severity: "critical" | "warning";
  status: "firing" | "resolved" | "evaluation_failed";
  summary: string;
  description: string | null;
  occurredAt: string;
  detailsUrl: string;
  rowCount: number;
};

export type DesktopNotification =
  | DesktopFailureNotification
  | DesktopAlertNotification;
