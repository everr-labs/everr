import { queryOptions } from "@tanstack/react-query";
import {
  listAlertingChannels,
  listAlertingInhibitions,
  listAlertingReceivers,
  listAlertingRoutes,
} from "./server";

export const deliveryQueries = {
  routes: () =>
    queryOptions({
      queryKey: ["alerting", "routes"] as const,
      queryFn: () => listAlertingRoutes(),
    }),
  receivers: () =>
    queryOptions({
      queryKey: ["alerting", "receivers"] as const,
      queryFn: () => listAlertingReceivers(),
    }),
  channels: () =>
    queryOptions({
      queryKey: ["alerting", "channels"] as const,
      queryFn: () => listAlertingChannels(),
    }),
  inhibitions: () =>
    queryOptions({
      queryKey: ["alerting", "inhibitions"] as const,
      queryFn: () => listAlertingInhibitions(),
    }),
};
