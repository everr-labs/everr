export interface FailurePattern {
  pattern: string;
  count: number;
  affectedRepos: string[];
  sampleTraceIds: string[];
  sampleRunIds: string[];
  sampleJobNames: string[];
  lastOccurrence: string;
}

export interface FailureTrendPoint {
  date: string;
  totalFailures: number;
  uniquePatterns: number;
}

export interface FailureByRepo {
  repo: string;
  failureCount: number;
  topPattern: string;
}
