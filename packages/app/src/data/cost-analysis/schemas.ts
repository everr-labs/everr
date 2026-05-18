import type { BucketGranularity } from "@/lib/time-range";

export type { BucketGranularity };

export const BREAKDOWN_OTHER_KEY = "__other__";

export interface CostSummary {
  totalCost: number;
  totalMinutes: number;
  totalBillingMinutes: number;
  totalJobs: number;
  costByOs: { os: string; cost: number; jobs: number }[];
  selfHostedMinutes: number;
  selfHostedJobs: number;
}

export type CostMetric = "spend" | "minutes";

export interface CostOverTimeBreakdownPoint {
  date: string;
  cost: Record<string, number>;
  minutes: Record<string, number>;
}

export interface CostOverTimeBreakdown {
  granularity: BucketGranularity;
  topKeys: string[];
  hasOther: boolean;
  points: CostOverTimeBreakdownPoint[];
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
