import { queryOptions } from "@tanstack/react-query";
import { ALERTING_POLL_INTERVAL_MS } from "../polling";
import {
  listAlertingChannelHealth,
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
  /** Recent delivery outcomes per channel name; keyed by nothing but the org. */
  channelHealth: () =>
    queryOptions({
      queryKey: ["alerting", "channel-health"] as const,
      queryFn: () => listAlertingChannelHealth(),
      refetchInterval: ALERTING_POLL_INTERVAL_MS,
    }),
  inhibitions: () =>
    queryOptions({
      queryKey: ["alerting", "inhibitions"] as const,
      queryFn: () => listAlertingInhibitions(),
    }),
};
