import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pause, Play, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { listCcRules, pauseCcRule, resumeCcRule } from "@/data/cc/server";
import type { CcRuleView } from "@/data/cc/types";
import {
  CcEmptyState,
  CcQueryError,
  CcRuleHealthDot,
  CcSeverityBadge,
  CcTableSkeleton,
  ccErrorMessage,
  formatInterval,
  ruleDisplayName,
} from "./-cc-shared";

const ccRulesQuery = () =>
  queryOptions({ queryKey: ["cc", "rules"], queryFn: () => listCcRules() });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/rules",
)({
  staticData: { breadcrumb: "Rules" },
  head: () => ({ meta: [{ title: "Everr - Advanced Alerting Rules" }] }),
  loader: ({ context: { queryClient } }) =>
    queryClient.prefetchQuery(ccRulesQuery()),
  component: CcRulesPage,
});

function CcRulesPage() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccRulesQuery());

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
      cell: (r) => {
        const name = ruleDisplayName(r.spec, r.id);
        const idPrefix = r.id.slice(0, 8);
        return (
          <Link
            to="/cc-alerting/rules/$ruleId"
            params={{ ruleId: r.id }}
            className="underline-offset-4 hover:underline"
          >
            <span className="flex items-baseline gap-2">
              <span className="font-medium">{name}</span>
              {name !== idPrefix && (
                <span className="font-mono text-muted-foreground text-xs">
                  {idPrefix}
                </span>
              )}
            </span>
          </Link>
        );
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
          {formatInterval(r.spec.interval_secs)}
        </span>
      ),
    },
    {
      header: "Health",
      cell: (r) => <CcRuleHealthDot rule={r} />,
    },
    {
      header: "State",
      cell: (r) =>
        r.paused ? (
          <span className="text-amber-600 dark:text-amber-400">paused</span>
        ) : (
          <span className="text-muted-foreground">active</span>
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
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <CcTableSkeleton rows={5} />
          ) : (
            <DataTable
              data={data ?? []}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
