import { queryOptions } from "@tanstack/react-query";
import { listAlertingSilences } from "./server";

export const silenceQueries = {
  list: () =>
    queryOptions({
      queryKey: ["alerting", "silences"] as const,
      queryFn: () => listAlertingSilences(),
    }),
};
