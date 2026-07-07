import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pause, Play, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { listCcRulesPage, pauseCcRule, resumeCcRule } from "@/data/cc/server";
import type { CcRuleView } from "@/data/cc/types";
import {
  CcConceptNote,
  CcEmptyState,
  CcHealthBadge,
  CcQueryError,
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  ccErrorMessage,
  ccFormatTs,
} from "./-cc-shared";

const RULES_PAGE_LIMIT = 100;

type RuleHealthFilter = "degraded" | "healthy";

// Keyset-paginated listing: each page is CC's {items, next_cursor} envelope,
// and a null next_cursor is the last page. The key stays under ["cc", "rules"]
// so the pause/resume invalidation below keeps matching by prefix.
const ccRulesQuery = (health?: RuleHealthFilter) =>
  infiniteQueryOptions({
    queryKey: ["cc", "rules", "page", health ?? "all"],
    queryFn: ({ pageParam }) =>
      listCcRulesPage({
        data: {
          limit: RULES_PAGE_LIMIT,
          ...(pageParam ? { cursor: pageParam } : {}),
          ...(health ? { health } : {}),
        },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

// `health` narrows the listing server-side (CC's rule-health filter); Triage's
// degraded-rules count links here with ?health=degraded.
const RulesSearchSchema = z.object({
  health: z.enum(["degraded", "healthy"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/_dashboard/alerts/rules")(
  {
    staticData: { breadcrumb: "Rules" },
    head: () => ({ meta: [{ title: "Everr - Alerts Rules" }] }),
    validateSearch: RulesSearchSchema,
    loaderDeps: ({ search }) => ({ health: search.health }),
    loader: ({ context: { queryClient }, deps }) =>
      queryClient.prefetchInfiniteQuery(ccRulesQuery(deps.health)),
    component: CcRulesPage,
  },
);

function CcRulesPage() {
  const qc = useQueryClient();
  const { health } = Route.useSearch();
  const {
    data,
    isPending,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(ccRulesQuery(health));
  const rules = data?.pages.flatMap((p) => p.items) ?? [];

  const toggle = useMutation({
    mutationFn: (rule: CcRuleView) =>
      rule.paused
        ? resumeCcRule({ data: { ruleId: rule.id } })
        : pauseCcRule({ data: { ruleId: rule.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "rules"] });
      toast.success("Rule updated");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const columns: Column<CcRuleView>[] = [
    {
      header: "Rule",
      cell: (r) => (
        <Link
          to="/alerts/rules/$ruleId"
          params={{ ruleId: r.id }}
          className="font-mono text-primary hover:underline"
        >
          {r.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      header: "Severity",
      cell: (r) => <CcSeverityBadge severity={r.spec.severity} />,
    },
    {
      header: "Interval",
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.spec.interval_secs}s
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
            {formatRelativeTime(r.rollup.last_fired_at)}
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
      <CcConceptNote>
        A rule is a SQL query the alerting engine evaluates on a schedule. Each
        row it returns becomes an <strong>alert instance</strong>; if rows
        persist past the rule&rsquo;s <code>for</code> duration, the alert
        starts <strong>firing</strong>. Rules are defined as code and applied
        with <code>everr apply</code> — here you can inspect, test, and pause
        them.
      </CcConceptNote>
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Rules</CardTitle>
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
