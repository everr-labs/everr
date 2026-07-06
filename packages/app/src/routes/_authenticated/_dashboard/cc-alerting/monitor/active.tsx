import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BellOff } from "lucide-react";
import { listCcAlerts, listCcRoutes, listCcSilences } from "@/data/cc/server";
import type { CcAlert } from "@/data/cc/types";
import { useCcInvalidation } from "@/hooks/use-cc-invalidation";
import {
  CcEmptyState,
  CcInstanceStatusBadge,
  CcQueryError,
  CcStatusDot,
  CcTableSkeleton,
  ccFirstRoute,
  ccFormatTs,
  LabelSet,
} from "../-cc-shared";

const alertsQuery = () =>
  queryOptions({ queryKey: ["cc", "alerts"], queryFn: () => listCcAlerts() });
const routesQuery = () =>
  queryOptions({ queryKey: ["cc", "routes"], queryFn: () => listCcRoutes() });
const silencesQuery = () =>
  queryOptions({
    queryKey: ["cc", "silences"],
    queryFn: () => listCcSilences(),
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/monitor/active",
)({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(alertsQuery()),
      queryClient.prefetchQuery(routesQuery()),
      queryClient.prefetchQuery(silencesQuery()),
    ]),
  component: CcMonitorActive,
});

function Stat({
  tone,
  pulse,
  count,
  label,
}: {
  tone: "firing" | "pending" | "inactive";
  pulse?: boolean;
  count: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <CcStatusDot tone={tone} pulse={pulse} className="self-center" />
      <span className="font-semibold tabular-nums text-foreground">
        {count}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function CcMonitorActive() {
  useCcInvalidation();
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useQuery(alertsQuery());
  const routes = useQuery(routesQuery());
  const silences = useQuery(silencesQuery());

  const alerts = data ?? [];
  const counts = {
    firing: alerts.filter((a) => a.status === "firing").length,
    pending: alerts.filter((a) => a.status === "pending").length,
    inactive: alerts.filter((a) => a.status === "inactive").length,
  };
  const now = Date.now();
  const activeSilences = (silences.data ?? []).filter(
    (s) =>
      new Date(s.starts_at).getTime() <= now &&
      now < new Date(s.ends_at).getTime(),
  ).length;

  const destination = (a: CcAlert) => {
    if (routes.isPending)
      return <span className="text-muted-foreground">…</span>;
    const route = ccFirstRoute(routes.data ?? [], a.labels);
    return route ? (
      <span className="font-mono text-xs">{route.receiver}</span>
    ) : (
      <Link
        to="/alerts/notifications"
        hash="firehose"
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        webhook feed
      </Link>
    );
  };

  const columns: Column<CcAlert>[] = [
    {
      header: "Status",
      cell: (r) => <CcInstanceStatusBadge status={r.status} />,
    },
    { header: "Labels", cell: (r) => <LabelSet labels={r.labels} /> },
    {
      header: "Value",
      cell: (r) => <span className="tabular-nums">{r.value ?? "—"}</span>,
    },
    {
      header: "Rule",
      cell: (r) => (
        <Link
          to="/cc-alerting/rules/$ruleId"
          params={{ ruleId: r.rule }}
          className="font-mono text-primary hover:underline"
        >
          {r.rule.slice(0, 8)}
        </Link>
      ),
    },
    { header: "Notifies", cell: destination },
    { header: "Active since", cell: (r) => ccFormatTs(r.active_since) },
    {
      header: "",
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            navigate({
              to: "/cc-alerting/monitor/silences",
              state: { silencePrefill: r.labels } as never,
            })
          }
        >
          <BellOff data-icon="inline-start" />
          Mute
        </Button>
      ),
    },
  ];

  if (isError) return <CcQueryError error={error} />;

  return (
    <div className="space-y-3">
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Alert instances</CardTitle>
        </CardHeader>
        <CardContent>
          {!isPending && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 pb-3 text-sm">
              <Stat
                tone="firing"
                pulse={counts.firing > 0}
                count={counts.firing}
                label="firing"
              />
              <Stat tone="pending" count={counts.pending} label="pending" />
              <Stat tone="inactive" count={counts.inactive} label="inactive" />
              <span className="text-muted-foreground/40">·</span>
              <span className="inline-flex items-baseline gap-1.5">
                <span className="font-semibold tabular-nums text-foreground">
                  {activeSilences}
                </span>
                <span className="text-muted-foreground">muted</span>
              </span>
            </div>
          )}
          {isPending ? (
            <CcTableSkeleton rows={6} />
          ) : (
            <DataTable
              data={alerts}
              columns={columns}
              rowKey={(r) => r.key}
              emptyState={
                <CcEmptyState
                  icon={BellOff}
                  title="No alert instances"
                  hint="Nothing is firing or pending. Active rules will surface instances here as they evaluate."
                />
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
