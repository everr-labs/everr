import type { RunHistogramBucket } from "../schemas";

// The keys the histogram stacks by. `other` rolls up everything that isn't a
// completed success/failure/cancellation (in-progress, queued, skipped, …).
export const RUN_HISTOGRAM_KEYS = [
  "success",
  "failure",
  "cancellation",
  "other",
] as const satisfies readonly (keyof RunHistogramBucket)[];
export type RunHistogramKey = (typeof RUN_HISTOGRAM_KEYS)[number];

export const RUN_CONCLUSION_META = {
  success: {
    label: "Success",
    chartColor: "var(--color-green-600)",
  },
  failure: {
    label: "Failure",
    chartColor: "var(--color-red-600)",
  },
  cancellation: {
    label: "Cancelled",
    chartColor: "var(--muted-foreground)",
  },
  other: {
    label: "Other",
    chartColor: "var(--color-sky-500)",
  },
} satisfies Record<RunHistogramKey, { label: string; chartColor: string }>;
