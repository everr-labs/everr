import { queryOptions } from "@tanstack/react-query";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import { getHomeOverview } from "./server";

export const homeOverviewOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["home", "overview", input],
    queryFn: () => getHomeOverview({ data: input }),
  });
