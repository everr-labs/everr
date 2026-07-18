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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Gauge, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CcConceptNote,
  CcEmptyState,
  CcQueryError,
  CcStatusDot,
  CcTableSkeleton,
  ccErrorMessage,
} from "@/components/cc/shared";
import { ccQueries } from "@/data/cc/queries";
import { deleteCcSlo, pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import { ccFormatSloTarget, ccSloTiers, ccSloWindowLabel } from "@/data/cc/slo";
import type { CcSlo } from "@/data/cc/types";

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

function CcSlosPage() {
  const qc = useQueryClient();
  const slos = useQuery(ccQueries.slos());

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

  const columns: Column<CcSlo>[] = [
    {
      header: "SLO",
      cell: (s) => (
        <span className="flex flex-col">
          <Link
            to="/alerts/slos/$sloId"
            params={{ sloId: s.id }}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {s.name}
          </Link>
          <span className="font-mono text-[0.6875rem] text-muted-foreground">
            {s.id.slice(0, 8)}
          </span>
        </span>
      ),
    },
    {
      header: "Target",
      cell: (s) => (
        <span className="font-mono text-xs tabular-nums">
          {ccFormatSloTarget(s.spec.targetPercent)}
        </span>
      ),
    },
    {
      header: "Window",
      cell: (s) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {ccSloWindowLabel(s.spec)}
        </span>
      ),
    },
    {
      // The SLI's fan-out: label columns produce one SLI per group; none
      // means one scalar SLI for all traffic.
      header: "Groups by",
      cell: (s) => (
        <span className="font-mono text-xs text-muted-foreground">
          {s.spec.sli.label_columns.join(", ") || "—"}
        </span>
      ),
    },
    {
      header: "Tiers",
      cell: (s) => (
        <span className="font-mono text-xs text-muted-foreground">
          {ccSloTiers(s.spec)
            .map((t) => t.name)
            .join(", ")}
        </span>
      ),
    },
    {
      header: "State",
      cell: (s) => (
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
      cell: (s) => (
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
      <CcConceptNote>
        An SLO is a target for a service-level indicator: an{" "}
        <strong>SLI</strong> query returning <code>good</code> and{" "}
        <code>valid</code> event counts, an objective (e.g. <code>99.9%</code>)
        over a rolling window, and multi-window burn-rate tiers that alert when
        the <strong>error budget</strong> is burning too fast. SLOs are defined
        as code and applied with <code>everr apply</code> — here you can inspect
        their error budgets and pause them.
      </CcConceptNote>
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>SLOs</CardTitle>
          <CardDescription>
            Open an SLO to see its error budget, burn rates, and firing tiers
            per group.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {slos.isPending ? (
            <CcTableSkeleton rows={5} />
          ) : (
            <DataTable
              data={slos.data}
              columns={columns}
              rowKey={(s) => s.id}
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
