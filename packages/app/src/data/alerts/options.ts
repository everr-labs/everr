import { queryOptions } from "@tanstack/react-query";
import {
  getActiveAlerts,
  getAlertEvents,
  getAlertManagementAccess,
  getAlertRules,
  getRoutingLists,
} from "./server";

export const alertRulesOptions = (input: { active?: boolean } = {}) =>
  queryOptions({
    queryKey: ["alerts", "rules", input],
    queryFn: () => getAlertRules({ data: input }),
  });

export const activeAlertsOptions = () =>
  queryOptions({
    queryKey: ["alerts", "active"],
    queryFn: () => getActiveAlerts({ data: {} }),
  });

export const alertEventsOptions = (input: { limit?: number } = {}) =>
  queryOptions({
    queryKey: ["alerts", "events", input],
    queryFn: () => getAlertEvents({ data: { limit: input.limit ?? 50 } }),
  });

export const routingListsOptions = () =>
  queryOptions({
    queryKey: ["alerts", "routing-lists"],
    queryFn: () => getRoutingLists({ data: {} }),
  });

export const alertManagementAccessOptions = () =>
  queryOptions({
    queryKey: ["alerts", "management-access"],
    queryFn: () => getAlertManagementAccess({ data: {} }),
  });
