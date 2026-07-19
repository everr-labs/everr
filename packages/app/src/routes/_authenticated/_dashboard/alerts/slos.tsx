// SLO listing, led by status: each row answers "how is this promise doing" —
// error budget, burn rate, time to exhaustion, firing tiers — before showing
// the config that produced it. Rows sort by risk (firing, then thinnest
// budget), so the SLO most in danger is always the first one on the page.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Gauge, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CcBudgetBar, ccFmtBurn } from "@/components/cc/budget-bar";
import { CcPageIntro, CcTerm } from "@/components/cc/page-intro";
import {
  CcEmptyState,
  CcQueryError,
  CcSloTierBadge,
  CcStatusDot,
  CcTableSkeleton,
  ccErrorMessage,
} from "@/components/cc/shared";
import { ccQueries } from "@/data/cc/queries";
import { deleteCcSlo, pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import {
  ccFormatSloDuration,
  ccFormatSloTarget,
  ccSloCurrentBurn,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus } from "@/data/cc/types";

export const Route = createFileRoute("/_authenticated/_dashboard/alerts/slos")({
  staticData: { breadcrumb: "SLOs" },
  head: () => ({ meta: [{ title: "Everr - Alerts SLOs" }] }),
  loader: ({ context: { queryClient } }) =>
    queryClient.prefetchQuery(ccQueries.slos()),
  component: CcSlosPage,
});

function DeleteSloAction({
  slo,
  onDelete,
  pending,
}: {
  slo: CcSlo;
  onDelete: () => void;
  pending: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete SLO ${slo.name}`}
            disabled={pending}
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        <Trash2 />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete SLO “{slo.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Removes the SLO, its burn-rate instances, and its status snapshot.
            Alerts already firing for it resolve as their instances are deleted.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            Delete SLO
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// One listing row: the SLO plus its resolved status facts. `worst` is the
// group spending budget fastest (min budget remaining) — the row's headline.
type SloRow = {
  slo: CcSlo;
  statusPending: boolean;
  worst: CcSloGroupStatus | null;
  groupCount: number;
  firingTiers: { tier: string; severity: string }[];
};

function worstGroup(groups: CcSloGroupStatus[]): CcSloGroupStatus | null {
  if (groups.length === 0) return null;
  return groups.reduce((worst, g) =>
    (g.budget_remaining ?? Number.POSITIVE_INFINITY) <
    (worst.budget_remaining ?? Number.POSITIVE_INFINITY)
      ? g
      : worst,
  );
}

/** Risk rank for sorting: firing critical → firing → exhausted → the rest. */
function riskRank(row: SloRow): number {
  if (row.firingTiers.some((t) => t.severity === "critical")) return 0;
  if (row.firingTiers.length > 0) return 1;
  if (
    row.worst !== null &&
    row.worst.budget_remaining !== null &&
    row.worst.budget_remaining <= 0
  ) {
    return 2;
  }
  return 3;
}

function CcSlosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const slos = useQuery(ccQueries.slos());
  const slosData = slos.data ?? [];
  // One status query per SLO, cache-shared with the detail page. The listing
  // is small (a tenant's SLO set), so per-row polling stays cheap.
  const statuses = useQueries({
    queries: slosData.map((s) => ccQueries.sloStatus(s.id)),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ccQueries.slos().queryKey });

  const toggle = useMutation({
    mutationFn: (slo: CcSlo) =>
      slo.paused
        ? resumeCcSlo({ data: { sloId: slo.id } })
        : pauseCcSlo({ data: { sloId: slo.id } }),
    onSuccess: () => {
      invalidate();
      toast.success("SLO updated");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (slo: CcSlo) => deleteCcSlo({ data: { sloId: slo.id } }),
    onSuccess: () => {
      invalidate();
      toast.success("SLO deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const rows: SloRow[] = slosData
    .map((slo, i) => {
      const status = statuses[i];
      const groups = status.data?.payload?.groups ?? [];
      const tiers = ccSloTiers(slo.spec);
      const firingByName = new Map<string, string>();
      for (const g of groups) {
        for (const f of g.firing_tiers) {
          firingByName.set(
            f.tier,
            ccSloTierSeverity(tiers, { slo_tier: f.tier }),
          );
        }
      }
      return {
        slo,
        statusPending: status.isPending,
        worst: worstGroup(groups),
        groupCount: groups.length,
        firingTiers: [...firingByName].map(([tier, severity]) => ({
          tier,
          severity,
        })),
      };
    })
    .sort(
      (a, b) =>
        riskRank(a) - riskRank(b) ||
        (a.worst?.budget_remaining ?? Number.POSITIVE_INFINITY) -
          (b.worst?.budget_remaining ?? Number.POSITIVE_INFINITY) ||
        a.slo.name.localeCompare(b.slo.name),
    );

  const columns: Column<SloRow>[] = [
    {
      header: "SLO",
      cell: ({ slo: s }) => (
        <span className="flex flex-col gap-0.5">
          <Link
            to="/alerts/slos/$sloId"
            params={{ sloId: s.id }}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {s.name}
          </Link>
          <span className="text-[0.6875rem] whitespace-nowrap text-muted-foreground">
            {ccFormatSloTarget(s.spec.targetPercent)} over{" "}
            {ccSloWindowLabel(s.spec)}
            {s.spec.sli.label_columns.length > 0 && (
              <>
                {" · by "}
                <span className="font-mono">
                  {s.spec.sli.label_columns.join(", ")}
                </span>
              </>
            )}
          </span>
        </span>
      ),
    },
    {
      header: (
        <CcTerm def="What's left of the allowed failure. At a 99.5% target over 7d, 0.5% of events may fail; the budget is how much of that allowance remains.">
          Error budget
        </CcTerm>
      ),
      cell: (row) =>
        row.statusPending ? (
          <Skeleton className="h-4 w-40" />
        ) : row.worst === null ? (
          <span className="text-xs text-muted-foreground">no snapshot yet</span>
        ) : (
          <span className="flex flex-col gap-0.5">
            <CcBudgetBar remaining={row.worst.budget_remaining} />
            {row.groupCount > 1 && (
              <span className="text-[0.6875rem] text-muted-foreground">
                worst of {row.groupCount} groups
                {Object.values(row.worst.labels).length > 0 && (
                  <>
                    {": "}
                    <span className="font-mono">
                      {Object.values(row.worst.labels).join(", ")}
                    </span>
                  </>
                )}
              </span>
            )}
          </span>
        ),
    },
    {
      header: (
        <CcTerm def="How fast the budget is being spent: 1× spends exactly the budget over the SLO window; 14× empties it fourteen times sooner. Tiers fire on sustained burn.">
          Burn rate
        </CcTerm>
      ),
      cell: (row) => {
        if (row.statusPending || row.worst === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const burn = ccSloCurrentBurn(
          ccSloTiers(row.slo.spec),
          row.worst.tiers,
        );
        if (burn === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const tone = row.firingTiers.some((t) => t.severity === "critical")
          ? "font-medium text-destructive"
          : row.firingTiers.length > 0
            ? "font-medium text-amber-600 dark:text-amber-400"
            : burn.rate >= 1
              ? "text-foreground"
              : "text-muted-foreground";
        return (
          <span
            className={`font-mono text-xs tabular-nums whitespace-nowrap ${tone}`}
          >
            {ccFmtBurn(burn.rate)}
            <span className="text-muted-foreground"> / {burn.window}</span>
          </span>
        );
      },
    },
    {
      header: "Time to exhaustion",
      cell: (row) => (
        <span className="font-mono text-xs tabular-nums whitespace-nowrap">
          {row.worst === null || row.worst.time_to_exhaustion_secs === null
            ? "—"
            : row.worst.time_to_exhaustion_secs === 0
              ? "exhausted"
              : ccFormatSloDuration(row.worst.time_to_exhaustion_secs)}
        </span>
      ),
    },
    {
      header: "Firing",
      cell: (row) =>
        row.firingTiers.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="flex flex-wrap gap-2">
            {row.firingTiers.map((f) => (
              <CcSloTierBadge
                key={f.tier}
                tier={f.tier}
                severity={f.severity}
              />
            ))}
          </span>
        ),
    },
    {
      header: "State",
      cell: ({ slo: s }) => (
        <span className="inline-flex items-center gap-2">
          {s.paused ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CcStatusDot tone="inactive" />
              paused
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CcStatusDot tone="healthy" />
              active
            </span>
          )}
          {s.spec.suppressed && (
            // Evaluates fully but the dispatcher never notifies — worth a
            // loud flag, or the silence is invisible.
            <Badge variant="destructive">suppressed</Badge>
          )}
        </span>
      ),
    },
    {
      header: "",
      cell: ({ slo: s }) => (
        <span className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(s)}
          >
            {s.paused ? (
              <Play data-icon="inline-start" />
            ) : (
              <Pause data-icon="inline-start" />
            )}
            {s.paused ? "Resume" : "Pause"}
          </Button>
          <DeleteSloAction
            slo={s}
            onDelete={() => remove.mutate(s)}
            pending={remove.isPending}
          />
        </span>
      ),
    },
  ];

  if (slos.isError) return <CcQueryError error={slos.error} />;

  return (
    <div className="space-y-3">
      <CcPageIntro
        title="SLOs"
        lede="Reliability targets with an error budget: how much failure is affordable before each promise breaks."
        explainerLabel="How SLOs work"
        explainer={
          <>
            <p>
              An SLO promises a target (say <code>99.9%</code>) over a rolling
              window. The <strong>SLI</strong> is a SQL query counting{" "}
              <code>good</code> and <code>valid</code> events; the gap between
              the target and 100% is the <strong>error budget</strong> — the
              failure you are allowed before the promise breaks.
            </p>
            <p>
              The engine watches how fast the budget is being spent (the{" "}
              <strong>burn rate</strong>) over multiple windows and fires
              alerting <strong>tiers</strong> at different urgencies: fast-burn
              pages someone now, ticket nudges tomorrow. SLOs are defined as
              code and applied with <code>everr apply</code>; here you inspect
              their budgets, pause them, or delete them.
            </p>
          </>
        }
      />
      <Card inset="flush-content">
        <CardContent>
          {slos.isPending ? (
            <CcTableSkeleton rows={5} />
          ) : (
            <DataTable
              data={rows}
              columns={columns}
              rowKey={(row) => row.slo.id}
              onRowClick={(row, e) => {
                if ((e.target as HTMLElement).closest("a,button") !== null) {
                  return;
                }
                void navigate({
                  to: "/alerts/slos/$sloId",
                  params: { sloId: row.slo.id },
                });
              }}
              emptyState={
                <CcEmptyState
                  icon={Gauge}
                  title="No SLOs defined"
                  hint={
                    <>
                      Define an SLO as code — an SLI query with{" "}
                      <code>good</code>/<code>valid</code> counts, a target, and
                      a rolling window — and apply it with{" "}
                      <code>everr apply</code>. The engine tracks the error
                      budget and alerts on burn rate.
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
