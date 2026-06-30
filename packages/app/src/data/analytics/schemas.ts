import { TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";

export const TimeRangeInputSchema = z.object({ timeRange: TimeRangeSchema });
export type TimeRangeInput = z.infer<typeof TimeRangeInputSchema>;
