import { queryOptions } from "@tanstack/react-query";
import { getAlertingDefaultDestination, listAlertingChannels } from "./server";

export const deliveryQueries = {
  channels: () =>
    queryOptions({
      queryKey: ["alerting", "channels"] as const,
      queryFn: () => listAlertingChannels(),
    }),
  defaultDestination: () =>
    queryOptions({
      queryKey: ["alerting", "default-destination"] as const,
      queryFn: () => getAlertingDefaultDestination(),
    }),
};
