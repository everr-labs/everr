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
import { BookOpenText, Pause, Play, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { CcPageIntro } from "@/components/cc/page-intro";
import {
  CcEmptyState,
  CcHealthBadge,
  CcQueryError,
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  ccErrorMessage,
  ccFormatTs,
} from "@/components/cc/shared";
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import { ccQueries } from "@/data/cc/queries";
import { CcRuleHealthStatusSchema } from "@/data/cc/schema";
import { pauseCcRule, resumeCcRule } from "@/data/cc/server";
import { ccFormatSloDuration } from "@/data/cc/slo";
import type { CcRuleView } from "@/data/cc/types";

// `health` narrows the listing server-side (CC's rule-health filter); Triage's
// degraded-rules count links here with ?health=degraded.
const RulesSearchSchema = z.object({
  health: CcRuleHealthStatusSchema.optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/_dashboard/alerts/rules")(
  {
    staticData: { breadcrumb: "Rules" },
    head: () => ({ meta: [{ title: "Everr - Alerts Rules" }] }),
    validateSearch: RulesSearchSchema,
    loaderDeps: ({ search }) => ({
      health: search.health,
      preview: search.preview,
    }),
    loader: ({ context: { queryClient }, deps }) =>
      queryClient.prefetchInfiniteQuery(
        ccQueries.rulesPage(deps.health, deps.preview),
      ),
    component: CcRulesPage,
  },
);

function CcRulesPage() {
  const qc = useQueryClient();
  const { health, preview } = Route.useSearch();
  const {
    data,
    isPending,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(ccQueries.rulesPage(health, preview));
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
          <span className="flex flex-col">
            <Link
              to="/alerts/rules/$project/$slug"
              params={{ project: identity.project, slug: identity.slug }}
              className={cn(
                "font-medium text-foreground underline-offset-2 hover:underline",
                identity.name === identity.shortId && "font-mono",
              )}
            >
              {identity.name}
            </Link>
            {/* The id stays reachable (copy/grep against as-code specs) but
                steps back; suppressed entirely when it IS the name. */}
            {identity.name !== identity.shortId && (
              <span className="font-mono text-[0.6875rem] text-muted-foreground">
                {identity.shortId}
              </span>
            )}
          </span>
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
      // The rolled-up alert state CC computes per rule. Distinct from the
      // paused/active "State" column below: this is what the alert is doing,
      // not whether the rule is scheduled. Optional for rollout safety (a CC
      // without rollups omits the field).
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
      header: "Health",
      cell: (r) => <CcHealthBadge status={r.health.status} />,
    },
    {
      header: "State",
      cell: (r) =>
        r.paused ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <CcStatusDot tone="inactive" />
            paused
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <CcStatusDot tone="healthy" />
            active
          </span>
        ),
    },
    {
      header: "",
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(r)}
        >
          {r.paused ? (
            <Play data-icon="inline-start" />
          ) : (
            <Pause data-icon="inline-start" />
          )}
          {r.paused ? "Resume" : "Pause"}
        </Button>
      ),
    },
  ];

  if (isError) return <CcQueryError error={error} />;

  return (
    <div className="space-y-3">
      <CcPageIntro
        title="Rules"
        lede="The queries watching your telemetry: what each one checks, whether it fires, and whether it can still evaluate."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />
      <Card inset="flush-content">
        <CardHeader>
          {/* No CardTitle: the page h1 directly above already says "Rules" —
              the header carries only the hint / active-filter readout. */}
          <CardDescription>
            {health ? (
              <>
                Showing {health} rules only ·{" "}
                <Link
                  to="/alerts/rules"
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  clear filter
                </Link>
              </>
            ) : (
              "Open a rule to see its query, health, and run an ad-hoc test."
            )}
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
