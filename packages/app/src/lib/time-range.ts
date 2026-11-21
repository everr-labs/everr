export { ResolvedTimeRangeSearchSchema, TimeRangeSearchSchema } from "@everr/ui/lib/time-range";

export type BucketGranularity = "hour" | "day";

export function getBucketGranularity(fromDate: Date, toDate: Date): BucketGranularity {
  const hours = (toDate.getTime() - fromDate.getTime()) / 3_600_000;
  return hours <= 36 ? "hour" : "day";
}
