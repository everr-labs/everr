// packages/app/src/components/cc/getting-started.tsx
//
// The alerting empty-state checklist: what to do, in order, to go from zero
// to a delivered notification. State-aware (steps check themselves off as
// channels/receivers/rules/routes appear), so it doubles as a progress view
// for a half-configured org. This is a genuine sequence, hence the numbers.
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { cn } from "@everr/ui/lib/utils";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import {
  listCcChannels,
  listCcReceivers,
  listCcRoutes,
  listCcRules,
} from "@/data/cc/server";

// Shared ["cc", ...] keys: the delivery and triage pages already cache these.
const q = {
  rules: () =>
    queryOptions({ queryKey: ["cc", "rules"], queryFn: () => listCcRules() }),
  channels: () =>
    queryOptions({
      queryKey: ["cc", "channels"],
      queryFn: () => listCcChannels(),
    }),
  receivers: () =>
    queryOptions({
      queryKey: ["cc", "receivers"],
      queryFn: () => listCcReceivers(),
    }),
  routes: () =>
    queryOptions({ queryKey: ["cc", "routes"], queryFn: () => listCcRoutes() }),
};

const EXAMPLE_RULE = `# everr/high-error-rate.alert.yaml
kind: AlertRule
metadata:
  name: high-error-rate
spec:
  evaluationInterval: 1m   # how often the query runs (1m is the minimum)
  notificationMessage:
    title: "\${ServiceName} logged \${value} errors in 15 minutes"
  instanceLabels: [ServiceName]
  valueColumn: errors
  query: |
    SELECT ServiceName, countIf(SeverityNumber >= 17) AS errors
    FROM logs
    WHERE Timestamp >= now() - INTERVAL 15 MINUTE
    GROUP BY ServiceName
    HAVING errors > 50`;

function Step({
  index,
  done,
  title,
  children,
}: {
  index: number;
  done: boolean;
  title: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold",
          done
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
            : "border-border bg-muted/30 text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" /> : index}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p
          className={cn(
            "text-sm font-medium",
            done ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {title}
          {done && (
            <span className="ml-2 text-xs font-normal text-emerald-500">
              done
            </span>
          )}
        </p>
        {!done && children}
      </div>
    </li>
  );
}

function StepLink({ hash, children }: { hash: string; children: ReactNode }) {
  return (
    <Link
      to="/alerts/delivery"
      hash={hash}
      className="text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline"
    >
      {children}
    </Link>
  );
}

export function AlertsGettingStarted({ bare = false }: { bare?: boolean }) {
  const rules = useQuery(q.rules());
  const channels = useQuery(q.channels());
  const receivers = useQuery(q.receivers());
  const routes = useQuery(q.routes());

  const hasChannels = (channels.data ?? []).length > 0;
  const hasReceivers = (receivers.data ?? []).length > 0;
  const hasRules = (rules.data ?? []).length > 0;
  const hasRoutes = (routes.data ?? []).length > 0;

  const steps = (
    <ol className="space-y-4">
      <Step
        index={1}
        done={hasChannels && hasReceivers}
        title="Choose where notifications go"
      >
        <p className="max-w-prose text-xs text-muted-foreground">
          Connect a channel (Slack, Telegram, email, PagerDuty, or a webhook)
          and group it into a <strong>receiver</strong>, the named destination
          alerts get routed to.{" "}
          {hasChannels && !hasReceivers && (
            <>Your channel is connected; it still needs a receiver. </>
          )}
          <StepLink hash="channels">Set up delivery</StepLink>
        </p>
      </Step>
      <Step index={2} done={hasRules} title="Define an alert rule as code">
        <p className="max-w-prose text-xs text-muted-foreground">
          A rule is a SQL query over your telemetry: every row it returns is a
          firing alert. Drop a file like this into your repo&rsquo;s{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
            everr/
          </code>{" "}
          directory and run{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
            everr apply ./everr
          </code>
          .
        </p>
        <pre className="max-w-xl overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-[0.6875rem] leading-relaxed ring-1 ring-foreground/10">
          {EXAMPLE_RULE}
        </pre>
      </Step>
      <Step index={3} done={hasRoutes} title="Route alerts to your receiver">
        <p className="max-w-prose text-xs text-muted-foreground">
          A catch-all route is enough to start: it sends every alert to one
          receiver. Until a route exists, alerts only reach firehose webhook
          subscriptions. <StepLink hash="routes">Add a route</StepLink>
        </p>
      </Step>
    </ol>
  );

  if (bare) return <div className="px-4 py-6">{steps}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get alerted when something breaks</CardTitle>
        <CardDescription>
          Three steps from zero to a delivered notification.
        </CardDescription>
      </CardHeader>
      <CardContent>{steps}</CardContent>
    </Card>
  );
}
