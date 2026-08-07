import { queryOptions } from "@tanstack/react-query";
import { ALERTING_POLL_INTERVAL_MS } from "../polling";
import { listAlertingAlerts } from "./server";

export const alertInstanceQueries = {
  list: (preview?: string) => {
    const previewName = preview?.trim() || null;
    return queryOptions({
      queryKey: ["alerting", "alerts", previewName] as const,
      queryFn: () =>
        previewName === null
          ? listAlertingAlerts()
          : listAlertingAlerts({ data: { preview: previewName } }),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    });
  },
};
