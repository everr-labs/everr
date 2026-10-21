import { queryOptions } from "@tanstack/react-query";
import { getTraceReplay, type TraceReplayInput } from "./server";

// The input is the whole key. It holds no clock-relative value, so the key
// stays the same across renders.
export const replayQueryOptions = (input: TraceReplayInput) =>
  queryOptions({
    queryKey: ["replay", input],
    queryFn: () => getTraceReplay({ data: input }),
  });
