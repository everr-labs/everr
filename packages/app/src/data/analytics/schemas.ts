import { ExactTimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";

export const TimeRangeInputSchema = z.object({ timeRange: ExactTimeRangeSchema });
export type TimeRangeInput = z.infer<typeof TimeRangeInputSchema>;
