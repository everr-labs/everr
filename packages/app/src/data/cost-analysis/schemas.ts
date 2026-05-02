export interface CostSummary {
  totalCost: number;
  totalMinutes: number;
  totalBillingMinutes: number;
  totalJobs: number;
  costByOs: { os: string; cost: number; jobs: number }[];
  selfHostedMinutes: number;
  selfHostedJobs: number;
}

export interface CostOverTimePoint {
  date: string;
  totalCost: number;
  linuxCost: number;
  windowsCost: number;
  macosCost: number;
  selfHostedMinutes: number;
}

export interface CostByRunner {
  labels: string;
  tier: string;
  os: string;
  isSelfHosted: boolean;
  totalJobs: number;
  totalMinutes: number;
  billingMinutes: number;
  estimatedCost: number;
  ratePerMinute: number;
}

export interface CostByRepo {
  repo: string;
  totalJobs: number;
  totalMinutes: number;
  billingMinutes: number;
  estimatedCost: number;
  topRunner: string;
}

export interface CostByWorkflow {
  repo: string;
  workflow: string;
  totalJobs: number;
  totalMinutes: number;
  billingMinutes: number;
  estimatedCost: number;
  avgCostPerRun: number;
}
