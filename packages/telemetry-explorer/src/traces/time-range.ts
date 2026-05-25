import { isValid } from "@everr/datemath";
import { z } from "zod";

const datemath = z.string().refine(isValid);

export const TimeRangeSearchSchema = z.object({
  from: datemath.optional(),
  to: datemath.optional(),
  refresh: z.string().optional(),
});
