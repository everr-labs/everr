import { ExploreSearchShape } from "@everr/telemetry-explorer/filters";
import { LenientTimeRangeSearchSchema } from "@everr/ui/lib/time-range";
import type { z } from "zod";

export const RecordingsSearchSchema = LenientTimeRangeSearchSchema.extend(ExploreSearchShape);
export type RecordingsSearch = z.infer<typeof RecordingsSearchSchema>;
export const defaultRecordingsSearch = RecordingsSearchSchema.parse({});
