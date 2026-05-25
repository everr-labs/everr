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
