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
  CcStatusDot,
  CcTableSkeleton,
  ccErrorMessage,
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
      cell: (r) => (
        <Link
          to="/cc-alerting/rules/$ruleId"
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
      header: "Health",
      cell: (r) => <CcRuleHealthDot rule={r} />,
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
