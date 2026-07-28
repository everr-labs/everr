import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { cn } from "@everr/ui/lib/utils";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpenText, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { CcPageIntro } from "@/components/cc/page-intro";
import {
  CcEmptyState,
  CcPauseToggle,
  CcQueryError,
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  ccErrorMessage,
  ccFormatTs,
} from "@/components/cc/shared";
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcRule, resumeCcRule } from "@/data/cc/server";
import { ccFormatSloDuration } from "@/data/cc/slo";
import type { CcRuleView } from "@/data/cc/types";

export const Route = createFileRoute("/_authenticated/_dashboard/alerts/rules")(
  {
    staticData: { breadcrumb: "Rules" },
    head: () => ({ meta: [{ title: "Everr - Alerts Rules" }] }),
    loaderDeps: ({ search }) => ({ preview: search.preview }),
    loader: ({ context: { queryClient }, deps }) =>
      queryClient.prefetchInfiniteQuery(ccQueries.rulesPage(deps.preview)),
    component: CcRulesPage,
  },
);

function CcRulesPage() {
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
  } = useInfiniteQuery(ccQueries.rulesPage(preview));
  const rules = data?.pages.flatMap((p) => p.items) ?? [];

  const toggle = useMutation({
    mutationFn: (rule: CcRuleView) =>
      rule.paused
        ? resumeCcRule({ data: { ruleId: rule.id } })
        : pauseCcRule({ data: { ruleId: rule.id } }),
    onSuccess: () => {
      // The ["cc", "rules"] prefix also matches the paginated page keys.
      qc.invalidateQueries({ queryKey: ccQueries.rules().queryKey });
      toast.success("Rule updated");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const columns: Column<CcRuleView>[] = [
    {
      header: "Rule",
      cell: (r) => {
        const identity = ccRuleIdentity(r);
        return (
          <Link
            to="/alerts/rules/$project/$slug"
            params={{ project: identity.project, slug: identity.slug }}
            className={cn(
              "font-medium text-foreground underline-offset-2 hover:underline",
              // A rule with no display name IS its id, so it keeps the mono
              // face that makes an id readable.
              identity.name === identity.shortId && "font-mono",
            )}
          >
            {identity.name}
          </Link>
        );
      },
    },
    {
      header: "",
      cell: (r) => {
        const { runbook, name } = ccRuleIdentity(r);
        return runbook ? (
          <Link
            to="/runbooks/$project/$slug"
            params={runbook}
            aria-label={`Open runbook for ${name}`}
            title="Open runbook"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:bg-muted/50 hover:text-foreground focus-visible:outline-primary"
          >
            <BookOpenText className="size-3.5" />
          </Link>
        ) : null;
      },
    },
    {
      header: "Severity",
      cell: (r) => <CcSeverityBadge severity={r.spec.severity} />,
    },
    {
      header: "Interval",
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {/* Human units ("30m", not "1800s") — the machine unit is recall
              tax; the exact seconds stay in the as-code spec. */}
          {ccFormatSloDuration(r.spec.interval_secs)}
        </span>
      ),
    },
    {
      // The rolled-up alert state CC computes per rule: what the alert is
      // doing, not whether the rule is scheduled (that reads off the
      // Pause/Resume control). Optional for rollout safety (a CC without
      // rollups omits the field).
      header: "Alert state",
      cell: (r) =>
        r.rollup ? (
          r.rollup.alert_state === "firing" ? (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <CcStatusDot tone="firing" pulse />
              firing · {r.rollup.firing_instance_count}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {r.rollup.alert_state}
            </span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: "Last fired",
      cell: (r) =>
        r.rollup?.last_fired_at ? (
          <span
            className="whitespace-nowrap text-muted-foreground"
            title={ccFormatTs(r.rollup.last_fired_at)}
          >
            <RelativeTime timestamp={r.rollup.last_fired_at} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: "",
      cell: (r) => (
        <CcPauseToggle
          paused={r.paused}
          pending={toggle.isPending}
          kind="alert rule"
          name={ccRuleIdentity(r).name}
          onToggle={() => toggle.mutate(r)}
        />
      ),
    },
  ];

  if (isError) return <CcQueryError error={error} />;

  return (
    <div className="space-y-3">
      <CcPageIntro
        title="Rules"
        lede="The queries watching your telemetry: what each one checks and whether it is firing right now."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />
      <Card inset="flush-content">
        <CardHeader>
          {/* No CardTitle: the page h1 directly above already says "Rules",
              so the header carries only the hint. */}
          <CardDescription>
            Open a rule to see its query and what it is doing right now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <CcTableSkeleton rows={5} />
          ) : (
            <>
              <DataTable
                data={rules}
                columns={columns}
                rowKey={(r) => r.id}
                emptyState={
                  <CcEmptyState
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
