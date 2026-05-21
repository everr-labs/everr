import { isValid } from "@everr/datemath";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import * as z from "zod";

const datemath = z.string().refine(isValid);

export type RefreshInterval = string;

export const TimeRangeSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  refresh: z.string().optional(),
});

export const ResolvedTimeRangeSearchSchema = z.object({
  from: datemath
    .catch(DEFAULT_TIME_RANGE.from)
    .default(DEFAULT_TIME_RANGE.from),
  to: datemath.catch(DEFAULT_TIME_RANGE.to).default(DEFAULT_TIME_RANGE.to),
  refresh: z.string().default(""),
});

export type BucketGranularity = "hour" | "day";

export function getBucketGranularity(
  fromDate: Date,
  toDate: Date,
): BucketGranularity {
  const hours = (toDate.getTime() - fromDate.getTime()) / 3_600_000;
  return hours <= 36 ? "hour" : "day";
}
