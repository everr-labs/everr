import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { cn } from "@everr/ui/lib/utils";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CcPipelineDiagram } from "@/components/cc/pipeline-diagram";
import {
  listCcAlerts,
  listCcInhibitions,
  listCcReceivers,
  listCcRoutes,
  listCcRules,
  listCcSilences,
} from "@/data/cc/server";
import { useCcInvalidation } from "@/hooks/use-cc-invalidation";
import { CcQueryError } from "./-cc-shared";

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
  "/_authenticated/_dashboard/alerts/overview",
)({
  staticData: { breadcrumb: "Overview" },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(q.rules()),
      queryClient.prefetchQuery(q.alerts()),
      queryClient.prefetchQuery(q.routes()),
      queryClient.prefetchQuery(q.receivers()),
      queryClient.prefetchQuery(q.inhibitions()),
      queryClient.prefetchQuery(q.silences()),
    ]),
  component: CcOverviewPage,
});

type CcLinkTo =
  | "/alerts/rules"
  | "/alerts/monitor/active"
  | "/alerts/monitor/silences"
  | "/alerts/routing";

function StatCell({
  to,
  search,
  hash,
  label,
  value,
  hint,
  emphasis,
}: {
  to: CcLinkTo;
  search?: Record<string, string>;
  hash?: string;
  label: string;
  value: number;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      to={to}
      search={search}
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

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-foreground">{name}</dt>
      <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {children}
      </dd>
    </div>
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
  const firing = (alerts.data ?? []).filter(
    (a) => a.status === "firing",
  ).length;
  const now = Date.now();
  const activeSilences = (silences.data ?? []).filter(
    (s) =>
      new Date(s.starts_at).getTime() <= now &&
      now < new Date(s.ends_at).getTime(),
  ).length;

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
              to="/alerts/monitor/active"
              label="Firing now"
              value={firing}
              emphasis
              hint={firing > 0 ? "needs attention" : "all clear"}
            />
            <StatCell
              to="/alerts/rules"
              label="Rules"
              value={ruleList.length}
              hint={rulesHint}
            />
            <StatCell
              to="/alerts/routing"
              hash="routes"
              label="Routes"
              value={(routes.data ?? []).length}
            />
            <StatCell
              to="/alerts/routing"
              hash="receivers"
              label="Receivers"
              value={(receivers.data ?? []).length}
            />
            <StatCell
              to="/alerts/monitor/silences"
              label="Active silences"
              value={activeSilences}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How alerting works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            The alerting engine watches your telemetry with{" "}
            <span className="text-foreground">rules</span> — SQL queries
            evaluated on a schedule. When a rule matches, it raises an{" "}
            <span className="text-foreground">alert</span>, which is routed to
            the right people and channels. Here&rsquo;s the path every alert
            takes:
          </p>
          <CcPipelineDiagram
            firing={firing}
            routeCount={(routes.data ?? []).length}
            receiverCount={(receivers.data ?? []).length}
            silenceCount={activeSilences}
            inhibitionCount={(inhibitions.data ?? []).length}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Concepts</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Term name="Rule">
              A SQL query evaluated on a schedule. When it returns rows, each
              becomes an alert instance. Defined as code with{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
                everr apply
              </code>
              .
            </Term>
            <Term name="Alert">
              A single firing condition — one label set from a rule. It moves
              through <span className="text-foreground">pending</span> →{" "}
              <span className="text-foreground">firing</span> →{" "}
              <span className="text-foreground">resolved</span>.
            </Term>
            <Term name="Route">
              A matcher that decides which receiver an alert reaches. Routes are
              checked in priority order; the first match wins.
            </Term>
            <Term name="Receiver">
              A delivery channel — Slack, webhook, PagerDuty, email, or
              Telegram. Managed on the Routing page.
            </Term>
            <Term name="Silence">
              A temporary mute for alerts whose labels match — for maintenance
              windows and known noise.
            </Term>
            <Term name="Inhibition">
              A rule that suppresses downstream alerts while a related,
              higher-level alert is already firing.
            </Term>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
