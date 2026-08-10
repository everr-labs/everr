import { Button } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { RelativeTime } from "@everr/ui/components/relative-time";
import type { Tone } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import { ruleQueries } from "@/data/alerting/rules/queries";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import {
  pauseAlertingRule,
  resumeAlertingRule,
} from "@/data/alerting/rules/server";
import type { AlertingRuleView } from "@/data/alerting/types";
import {
  AlertingEmptyState,
  AlertingPauseToggle,
  AlertingQueryError,
  AlertingRunbookLink,
  AlertingTableSkeleton,
  alertingErrorMessage,
  alertingFormatTs,
} from "./-components/shared/components";
import {
  AlertingHealthHeart,
  AlertingSeverityBadge,
  AlertingStatusLabel,
} from "./-components/shared/status";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/rules",
)({
  staticData: { breadcrumb: "Rules" },
  head: () => ({ meta: [{ title: "Everr - Alerting Rules" }] }),
  loaderDeps: ({ search }) => ({ preview: search.preview }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.prefetchInfiniteQuery(ruleQueries.rulesPage(deps.preview)),
  component: AlertingRulesPage,
});

function RuleIdentityCell({ rule }: { rule: AlertingRuleView }) {
  const identity = alertingRuleIdentity(rule);
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <Link
          to="/alerts/rules/$project/$slug"
          params={{ project: identity.project, slug: identity.slug }}
          className={cn(
            "min-w-0 font-medium text-foreground underline-offset-2 hover:underline md:whitespace-nowrap",
            identity.name === identity.shortId && "font-mono",
          )}
        >
          {identity.name}
        </Link>
        <AlertingHealthHeart status={rule.health.status} />
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
        <span>Every {formatDurationSeconds(rule.spec.interval_secs)}</span>
        {rule.spec.severity !== "info" && (
          <>
            <span aria-hidden>·</span>
            <AlertingSeverityBadge severity={rule.spec.severity} />
          </>
        )}
        <span className="md:hidden">
          <RuleStatusCell rule={rule} />
        </span>
        {rule.rollup?.last_fired_at && (
          <span className="whitespace-nowrap md:hidden">
            Last fired <RelativeTime timestamp={rule.rollup.last_fired_at} />
          </span>
        )}
      </span>
    </span>
  );
}

function ruleStatus(rule: AlertingRuleView): {
  label: string;
  tone?: Tone;
  pulse?: boolean;
  muted?: boolean;
} {
  if (rule.paused) return { label: "Paused", tone: "muted" };
  if (rule.spec.suppressed) {
    return { label: "Suppressed", tone: "muted" };
  }
  if (rule.health.status === "degraded") {
    return { label: "Degraded", tone: "warning" };
  }
  if (!rule.rollup) return { label: "Not reported" };
  if (rule.rollup.alert_state === "firing") {
    const count = rule.rollup.firing_instance_count;
    return {
      label: count > 1 ? `Firing · ${count} instances` : "Firing",
      tone: "danger",
      pulse: true,
    };
  }
  if (rule.rollup.alert_state === "pending") {
    return { label: "Pending", tone: "warning", muted: true };
  }
  return { label: "OK", tone: "healthy", muted: true };
}

function RuleStatusCell({ rule }: { rule: AlertingRuleView }) {
  const status = ruleStatus(rule);
  if (!status.tone) {
    return (
      <span className="text-xs text-muted-foreground">{status.label}</span>
    );
  }
  return (
    <AlertingStatusLabel
      tone={status.tone}
      pulse={status.pulse}
      muted={status.muted}
      className="text-xs"
    >
      {status.label}
    </AlertingStatusLabel>
  );
}

function RuleLastFiredCell({ rule }: { rule: AlertingRuleView }) {
  return rule.rollup?.last_fired_at ? (
    <span
      className="whitespace-nowrap text-xs text-muted-foreground"
      title={alertingFormatTs(rule.rollup.last_fired_at)}
    >
      <RelativeTime timestamp={rule.rollup.last_fired_at} />
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">Never</span>
  );
}

function RuleUtilityCell({
  children,
  align = "start",
}: {
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <span
      className={cn("flex h-8 items-center", align === "end" && "justify-end")}
    >
      {children}
    </span>
  );
}

function AlertingRulesPage() {
  const qc = useQueryClient();
  const { preview } = Route.useSearch();
  const {
    data,
    isPending,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(ruleQueries.rulesPage(preview));
  const rules = data?.pages.flatMap((p) => p.items) ?? [];

  const toggle = useMutation({
    mutationFn: (rule: AlertingRuleView) =>
      rule.paused
        ? resumeAlertingRule({ data: { ruleId: rule.id } })
        : pauseAlertingRule({ data: { ruleId: rule.id } }),
    onSuccess: () => {
      // The ["alerting", "rules"] prefix also matches the paginated page keys.
      qc.invalidateQueries({ queryKey: ruleQueries.rules().queryKey });
      toast.success("Rule updated");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  const columns: Column<AlertingRuleView>[] = [
    {
      header: "Rule",
      className: "pb-2 pr-4 pl-3 md:w-full",
      cellClassName: "align-middle py-2 pr-4 pl-3 md:w-full",
      cell: (rule) => <RuleIdentityCell rule={rule} />,
    },
    {
      header: "",
      className: "w-11 pb-2 pr-4",
      cellClassName: "w-11 align-middle py-2 pr-4",
      cell: (rule) => {
        const { runbook, name } = alertingRuleIdentity(rule);
        return (
          <RuleUtilityCell>
            {runbook ? <AlertingRunbookLink {...runbook} name={name} /> : null}
          </RuleUtilityCell>
        );
      },
    },
    {
      header: "Status",
      className: "hidden w-28 pb-2 pr-4 md:table-cell",
      cellClassName: "hidden w-28 align-middle py-2 pr-4 md:table-cell",
      cell: (rule) => (
        <RuleUtilityCell>
          <RuleStatusCell rule={rule} />
        </RuleUtilityCell>
      ),
    },
    {
      header: "Last fired",
      className: "hidden w-24 pb-2 pr-4 lg:table-cell",
      cellClassName: "hidden w-24 align-middle py-2 pr-4 lg:table-cell",
      cell: (rule) => (
        <RuleUtilityCell>
          <RuleLastFiredCell rule={rule} />
        </RuleUtilityCell>
      ),
    },
    {
      header: "",
      className: "w-20 pb-2 pr-3",
      cellClassName: "w-20 align-middle py-2 pr-3",
      cell: (r) => (
        <RuleUtilityCell align="end">
          <AlertingPauseToggle
            paused={r.paused}
            pending={toggle.isPending}
            kind="alert rule"
            name={alertingRuleIdentity(r).name}
            onToggle={() => toggle.mutate(r)}
          />
        </RuleUtilityCell>
      ),
    },
  ];

  if (isError) return <AlertingQueryError error={error} />;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Rules"
        lede="The queries watching your telemetry: what each one checks and whether it is firing right now."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />
      <Card inset="flush-content">
        <CardContent>
          {isPending ? (
            <AlertingTableSkeleton rows={5} />
          ) : (
            <>
              <DataTable
                data={rules}
                columns={columns}
                rowKey={(r) => r.id}
                emptyState={
                  <AlertingEmptyState
                    icon={SlidersHorizontal}
                    title="No rules defined"
                    hint={
                      <>
                        Define alerting rules as code and apply them with{" "}
                        <code>everr apply</code>.
                      </>
                    }
                  />
                }
              />
              {hasNextPage && (
                <div className="flex justify-center px-3 py-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isFetchingNextPage}
                    onClick={() => fetchNextPage()}
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
