export interface DashboardStats {
  totalJobRuns: number;
  successfulRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  successRate: number;
}

export interface Repository {
  name: string;
  totalRuns: number;
  lastRunAt: string;
  successRate: number;
}

export interface DashboardDurationStats {
  avgDuration: number;
  p95Duration: number;
}

export interface TopFailingJob {
  jobName: string;
  repo: string;
  failureCount: number;
}

export interface TopFailingWorkflow {
  workflowName: string;
  repo: string;
  failureCount: number;
}
