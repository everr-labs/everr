export interface Run {
  traceId: string;
  runId: string;
  runAttempt: number;
  repo: string;
  branch: string;
  conclusion: string;
  workflowName: string;
  timestamp: string;
}

export interface Job {
  jobId: string;
  name: string;
  conclusion: string;
  duration: number; // ms
}

export interface Step {
  stepNumber: string;
  name: string;
  conclusion: string;
  duration: number; // ms
  startTime: number; // Unix ms
  endTime: number; // Unix ms
}

export interface LogEntry {
  timestamp: string;
  body: string;
}

export interface Span {
  spanId: string;
  parentSpanId: string;
  name: string;
  startTime: number; // Unix ms
  endTime: number; // Unix ms
  duration: number; // ms
  conclusion: string;
  jobId?: string;
  jobName?: string;
  stepNumber?: string;
  queueTime?: number; // ms - time spent waiting in queue (jobs only)
  // Job-specific attributes
  headBranch?: string;
  headSha?: string;
  runnerName?: string;
  labels?: string;
  sender?: string;
  runAttempt?: number;
  htmlUrl?: string;
  // Test-specific attributes
  testName?: string;
  testResult?: string;
  testDuration?: number;
  testFramework?: string;
  testLanguage?: string;
  isSubtest?: boolean;
  isSuite?: boolean;
}

export function isFailureConclusion(conclusion: string): boolean {
  const normalized = conclusion.trim().toLowerCase();
  return normalized === "failure" || normalized === "failed";
}
