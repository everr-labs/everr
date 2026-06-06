import { Skeleton } from "@everr/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertsPage } from "@/components/alerts/alerts-page";
import {
  activeAlertsOptions,
  alertEventsOptions,
  alertManagementAccessOptions,
  alertRulesOptions,
  routingListsOptions,
} from "@/data/alerts/options";
import type { SaveRoutingListInput } from "@/data/alerts/schemas";
import { deactivateAlertRule, saveRoutingList } from "@/data/alerts/server";

export const Route = createFileRoute("/_authenticated/_dashboard/alerts")({
  staticData: { breadcrumb: "Alerts" },
  head: () => ({
    meta: [{ title: "Everr - Alerts" }],
  }),
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.prefetchQuery(alertRulesOptions()),
      queryClient.prefetchQuery(activeAlertsOptions()),
      queryClient.prefetchQuery(alertEventsOptions()),
      queryClient.prefetchQuery(routingListsOptions()),
      queryClient.prefetchQuery(alertManagementAccessOptions()),
    ]);
  },
  component: AlertsRoutePage,
  pendingComponent: AlertsRouteSkeleton,
});

function AlertsRoutePage() {
  const queryClient = useQueryClient();
  const rules = useQuery(alertRulesOptions());
  const activeAlerts = useQuery(activeAlertsOptions());
  const events = useQuery(alertEventsOptions());
  const routingLists = useQuery(routingListsOptions());
  const access = useQuery(alertManagementAccessOptions());

  const invalidateAlerts = async () => {
    await queryClient.invalidateQueries({ queryKey: ["alerts"] });
  };

  const deactivate = useMutation({
    mutationFn: (id: number) => deactivateAlertRule({ data: { id } }),
    onSuccess: () => {
      toast.success("Alert deactivated");
      void invalidateAlerts();
    },
    onError: (error) => toast.error(error.message),
  });

  const saveRouting = useMutation({
    mutationFn: (input: SaveRoutingListInput) =>
      saveRoutingList({ data: input }),
    onSuccess: () => {
      toast.success("Routing list saved");
      void invalidateAlerts();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <AlertsPage
      rules={rules.data ?? []}
      activeAlerts={activeAlerts.data ?? []}
      events={events.data ?? []}
      routingLists={routingLists.data ?? []}
      canManage={access.data?.canManage ?? false}
      onDeactivateRule={(id) => deactivate.mutate(id)}
      onSaveRoutingList={(input) => saveRouting.mutate(input)}
    />
  );
}

function AlertsRouteSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-1 h-4 w-80" />
      </div>
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}
