import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { cn } from "@everr/ui/lib/utils";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { computeNotifiesChannels, joinWithAnd } from "@/components/cc/notifies";
import { CcPipelineDiagram } from "@/components/cc/pipeline-diagram";
import { isManagedCatchAllRoute } from "@/data/alerts/delivery-settings";
import {
  listCcAlerts,
  listCcInhibitions,
  listCcReceivers,
  listCcRoutes,
  listCcRules,
  listCcSilences,
} from "@/data/cc/server";
import type { CcAlert, CcRuleView } from "@/data/cc/types";
import { useCcInvalidation } from "@/hooks/use-cc-invalidation";
import { alertSettingsQueryOptions } from "../_previewable/alerts";
import { CcQueryError, CcStatusDot, ccFormatTs, LabelSet } from "./-cc-shared";

const q = {
  rules: () =>
    queryOptions({ queryKey: ["cc", "rules"], queryFn: () => listCcRules() }),
  alerts: () =>
    queryOptions({ queryKey: ["cc", "alerts"], queryFn: () => listCcAlerts() }),
  routes: () =>
    queryOptions({ queryKey: ["cc", "routes"], queryFn: () => listCcRoutes() }),
  receivers: () =>
    queryOptions({
      queryKey: ["cc", "receivers"],
      queryFn: () => listCcReceivers(),
    }),
  inhibitions: () =>
    queryOptions({
      queryKey: ["cc", "inhibitions"],
      queryFn: () => listCcInhibitions(),
    }),
  silences: () =>
    queryOptions({
      queryKey: ["cc", "silences"],
      queryFn: () => listCcSilences(),
    }),
};

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/overview",
)({
  staticData: { breadcrumb: "Overview" },
  head: () => ({ meta: [{ title: "Everr - Advanced Alerting" }] }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(q.rules()),
      queryClient.prefetchQuery(q.alerts()),
      queryClient.prefetchQuery(q.routes()),
      queryClient.prefetchQuery(q.receivers()),
      queryClient.prefetchQuery(q.inhibitions()),
      queryClient.prefetchQuery(q.silences()),
      queryClient.prefetchQuery(alertSettingsQueryOptions()),
    ]),
  component: CcOverviewPage,
});

type CcLinkTo =
  | "/cc-alerting/rules"
  | "/cc-alerting/monitor/active"
  | "/cc-alerting/monitor/silences"
  | "/alerts/notifications";

function StatCell({
  to,
  hash,
  label,
  value,
  hint,
  emphasis,
}: {
  to: CcLinkTo;
  hash?: string;
  label: string;
  value: number;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      to={to}
      hash={hash}
      className="flex flex-col gap-0.5 bg-card p-3 outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-muted/40 focus-visible:outline-primary"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-lg font-semibold tabular-nums",
          emphasis && value > 0 ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="min-h-4 text-[0.6875rem] text-muted-foreground">
        {hint ?? ""}
      </span>
    </Link>
  );
}

// One line of rule health, in the alerts home's dot idiom: a green all-clear,
// or the degraded rules listed by id with the amber warning dot.
function RuleHealthStrip({ rules }: { rules: CcRuleView[] }) {
  if (rules.length === 0) return null;
  const degraded = rules.filter((r) => r.health.status === "degraded");
  if (degraded.length === 0) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <CcStatusDot tone="healthy" />
        {rules.length === 1
          ? "1 rule healthy"
          : `${rules.length} rules healthy`}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-1.5 px-1 text-xs">
      <CcStatusDot tone="degraded" pulse />
      <span className="text-amber-600 dark:text-amber-400">
        {degraded.length} of {rules.length}{" "}
        {rules.length === 1 ? "rule" : "rules"} degraded:
      </span>
      {degraded.map((r) => (
        <Link
          key={r.id}
          to="/cc-alerting/rules/$ruleId"
          params={{ ruleId: r.id }}
          className="font-mono text-foreground underline-offset-2 hover:underline"
        >
          {r.id.slice(0, 8)}
        </Link>
      ))}
    </p>
  );
}

const FIRING_ROWS = 5;

function FiringNowCard({
  firing,
  notifies,
}: {
  firing: CcAlert[];
  notifies: (a: CcAlert) => string[];
}) {
  const columns: Column<CcAlert>[] = [
    {
      header: "Alert",
      cell: (a) => (
        <Link
          to="/cc-alerting/rules/$ruleId"
          params={{ ruleId: a.rule }}
          className="font-mono text-primary hover:underline"
        >
          {a.rule.slice(0, 8)}
        </Link>
      ),
    },
    { header: "Labels", cell: (a) => <LabelSet labels={a.labels} /> },
    { header: "Since", cell: (a) => ccFormatTs(a.active_since) },
    {
      header: "Notifies",
      cell: (a) => {
        const channels = notifies(a);
        return channels.length > 0 ? (
          <span className="text-xs">{joinWithAnd(channels)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            No channels configured
          </span>
        );
      },
    },
  ];

  return (
    <Card inset="flush-content">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CcStatusDot tone="firing" pulse />
          Firing now
        </CardTitle>
        {firing.length > FIRING_ROWS && (
          <CardAction>
            <Link
              to="/cc-alerting/monitor/active"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              View all {firing.length}
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <DataTable
          data={firing.slice(0, FIRING_ROWS)}
          columns={columns}
          rowKey={(a) => a.key}
        />
      </CardContent>
    </Card>
  );
}

function CcOverviewPage() {
  useCcInvalidation();
  const rules = useQuery(q.rules());
  const alerts = useQuery(q.alerts());
  const routes = useQuery(q.routes());
  const receivers = useQuery(q.receivers());
  const inhibitions = useQuery(q.inhibitions());
  const silences = useQuery(q.silences());
  const settings = useQuery(alertSettingsQueryOptions());

  // On a CC outage every stat would render 0 — actively misleading (a false
  // "all clear"). Any errored core query fails the whole page to the shared
  // "clickety-clack API unavailable" card, matching the sibling pages.
  const errored = [
    rules,
    alerts,
    routes,
    receivers,
    inhibitions,
    silences,
  ].find((query) => query.isError);
  if (errored) return <CcQueryError error={errored.error} />;

  const ruleList = rules.data ?? [];
  const paused = ruleList.filter((r) => r.paused).length;
  const degraded = ruleList.filter(
    (r) => r.health.status === "degraded",
  ).length;
  const firing = (alerts.data ?? []).filter((a) => a.status === "firing");
  const now = Date.now();
  const activeMutes = (silences.data ?? []).filter(
    (s) =>
      new Date(s.starts_at).getTime() <= now &&
      now < new Date(s.ends_at).getTime(),
  ).length;
  // The managed catch-all routes back the default channels; only the custom
  // rules count here, matching what the notifications page lists.
  const notificationRules = (routes.data ?? []).filter(
    (r) => !isManagedCatchAllRoute(r),
  );

  const rulesHint = [
    paused ? `${paused} paused` : null,
    degraded ? `${degraded} degraded` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-3">
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>System at a glance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
            <StatCell
              to="/cc-alerting/monitor/active"
              label="Firing now"
              value={firing.length}
              emphasis
              hint={firing.length > 0 ? "needs attention" : "all clear"}
            />
            <StatCell
              to="/cc-alerting/rules"
              label="Rules"
              value={ruleList.length}
              hint={rulesHint}
            />
            <StatCell
              to="/alerts/notifications"
              hash="routes"
              label="Notification rules"
              value={notificationRules.length}
            />
            <StatCell
              to="/alerts/notifications"
              hash="receivers"
              label="Channels"
              value={(receivers.data ?? []).length}
            />
            <StatCell
              to="/cc-alerting/monitor/silences"
              label="Active mutes"
              value={activeMutes}
            />
          </div>
        </CardContent>
      </Card>

      {firing.length > 0 && (
        <FiringNowCard
          firing={firing}
          notifies={(a) =>
            computeNotifiesChannels({
              delivery: settings.data?.delivery,
              routes: routes.data ?? [],
              labelSets: [a.labels],
            })
          }
        />
      )}

      <RuleHealthStrip rules={ruleList} />

      <Card>
        <CardHeader>
          <CardTitle>Delivery pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <CcPipelineDiagram
            firing={firing.length}
            routeCount={notificationRules.length}
            receiverCount={(receivers.data ?? []).length}
            silenceCount={activeMutes}
            inhibitionCount={(inhibitions.data ?? []).length}
          />
        </CardContent>
      </Card>
    </div>
  );
}
