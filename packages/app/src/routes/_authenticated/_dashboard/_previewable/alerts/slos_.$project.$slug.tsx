import { Badge } from "@everr/ui/components/badge";
import { buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpenText } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { alertingEventStatus } from "@/data/alerting/history/event-types";
import { alertHistoryQueries } from "@/data/alerting/history/queries";
import {
  ANN_LABEL_PREFIX,
  isReservedAnnotationKey,
} from "@/data/alerting/resource-annotations";
import {
  alertingSloChartRange,
  alertingSloHandles,
  alertingSloIdentity,
  alertingSloWindowLabel,
} from "@/data/alerting/slos/model";
import { sloQueries } from "@/data/alerting/slos/queries";
import { fromAlertingSlo } from "@/data/alerting/slos/resource/mapping";
import {
  pauseAlertingSlo,
  resumeAlertingSlo,
} from "@/data/alerting/slos/server";
import type { AlertingSlo, AlertingSloView } from "@/data/alerting/types";
import {
  AlertingBackLink,
  AlertingDefRow,
  AlertingEmptyState,
  AlertingPauseToggle,
  AlertingQueryError,
  alertingErrorMessage,
} from "./-components/shared/components";
import { AlertingHealthHeart } from "./-components/shared/status";
import {
  AlertingSummaryCard,
  AlertingSummaryStat,
} from "./-components/shared/summary-card";
import {
  SloBudgetChart,
  type SloBudgetEvent,
} from "./-components/slos/budget-chart";
import { SloSummaryCard } from "./-components/slos/status";
import { useAlertingFreshBudgets } from "./-components/slos/use-fresh-budgets";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/slos_/$project/$slug",
)({
  // This detail route is flat (slos_), so it doesn't inherit the SLOs listing
  // Add this crumb so the trail reads Alerts > SLOs > <name>.
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "SLOs", to: "/alerts/slos" },
      { label: match.loaderData?.name ?? "SLO" },
    ],
    // Every time-scoped surface here is pinned to the SLO's own window so it
    // agrees with the status hero; the global picker would break that.
    hideTimeRangePicker: true,
  },
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: async ({ context: { queryClient }, params, deps }) => {
    // Fetch the SLO first: its window sets the range everything else reads.
    const slo = await queryClient.ensureQueryData(
      sloQueries.sloByName(params.project, params.slug, deps.preview),
    );
    const range = alertingSloChartRange(slo.spec);
    await Promise.all([
      queryClient.prefetchQuery(sloQueries.status(slo.id)),
      // Skipped for a spec whose window doesn't parse (nothing to chart a
      // trailing window over).
      ...(range
        ? [
            queryClient.prefetchQuery(
              alertHistoryQueries.events(range, {
                slugs: alertingSloHandles(slo),
                preview: deps.preview,
              }),
            ),
            queryClient.prefetchQuery(sloQueries.budgetSeries(slo.id, range)),
          ]
        : []),
    ]);
    return { name: alertingSloIdentity(slo).name };
  },
  component: AlertingSloDetailPage,
});

// ── How's the budget ──────────────────────────────────────────────────────────

function StatusSection({ slo }: { slo: AlertingSlo }) {
  const status = useQuery(sloQueries.status(slo.id));
  // Read-time scan overrides the snapshot's throttled budget once it lands;
  // the snapshot renders instantly meanwhile.
  const fresh = useAlertingFreshBudgets([slo.id]);
  if (status.isError) {
    return <AlertingQueryError error={status.error} />;
  }
  if (status.isPending) {
    return (
      <AlertingSummaryCard ariaLabel="SLO activity summary">
        {[
          "Error budget left",
          "SLO",
          "SLI",
          "Burn rate",
          "Time to exhaustion",
        ].map((label) => (
          <AlertingSummaryStat
            key={label}
            label={label}
            value={<Skeleton className="h-6 w-16" />}
            detail={<Skeleton className="h-3 w-20" />}
          />
        ))}
      </AlertingSummaryCard>
    );
  }
  const payload = status.data?.payload ?? null;
  if (payload === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertingEmptyState
            title="No status snapshot yet"
            hint="The evaluator writes a snapshot on its first evaluation tick; until then there is no SLI or error budget to show."
          />
        </CardContent>
      </Card>
    );
  }

  const snapshot = fresh.apply(slo, payload);

  return (
    <>
      <SloSummaryCard slo={slo} status={snapshot} />
      {fresh.isPending(slo.id) && (
        <p className="px-1 text-[0.6875rem] text-muted-foreground">
          Error budget computing&hellip;
        </p>
      )}
    </>
  );
}

// ── How's the budget trending ─────────────────────────────────────────────────

// Only seeds the query key while `enabled: false` (a spec whose window
// doesn't parse); never fetched.
const CHART_RANGE_FALLBACK = { from: "now-1d", to: "now" } as const;

function BudgetHistorySection({
  slo,
  preview,
}: {
  slo: AlertingSloView;
  preview?: string;
}) {
  // Pinned to one SLO window ending now, so the rightmost point reads the
  // same span as the status hero.
  const range = alertingSloChartRange(slo.spec);
  const series = useQuery({
    ...sloQueries.budgetSeries(slo.id, range ?? CHART_RANGE_FALLBACK),
    enabled: range !== null,
  });
  // Scoped to this SLO's handles server-side so the row cap applies after
  // scoping: busy tenants can't push these markers out of the newest-N window.
  const events = useQuery({
    ...alertHistoryQueries.events(range ?? CHART_RANGE_FALLBACK, {
      slugs: alertingSloHandles(slo),
      preview,
    }),
    enabled: range !== null,
  });
  const budgetEvents = useMemo<SloBudgetEvent[]>(() => {
    const handles = new Set(alertingSloHandles(slo));
    const out: SloBudgetEvent[] = [];
    for (const e of events.data ?? []) {
      if (!handles.has(e.slug)) continue;
      const type = alertingEventStatus(e.eventType);
      // `slo_tier` rides in the instance labels.
      if (type) out.push({ t: e.timestamp, type, tier: e.labels.slo_tier });
    }
    return out;
  }, [events.data, slo]);

  // A spec whose window doesn't parse can't be charted.
  if (range === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget history</CardTitle>
        <CardDescription>
          Budget remaining over a trailing {alertingSloWindowLabel(slo.spec)}{" "}
          window.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {series.isError ? (
          <AlertingQueryError error={series.error} />
        ) : series.isPending ? (
          <Skeleton className="h-[240px] w-full" />
        ) : (
          <SloBudgetChart
            points={series.data}
            epoch={slo.budget_epoch}
            events={budgetEvents}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── What is it ────────────────────────────────────────────────────────────────

function ObjectiveSection({ slo }: { slo: AlertingSlo }) {
  const ann = slo.spec.annotations;
  // Show only user-defined annotations. The page displays generated values
  // in their dedicated fields.
  const labels = Object.entries(ann)
    .filter(([k]) => k.startsWith(ANN_LABEL_PREFIX))
    .map(([k, v]) => [k.slice(ANN_LABEL_PREFIX.length), v] as const);
  const annotations = Object.entries(ann).filter(
    ([k]) => !isReservedAnnotationKey(k),
  );

  const hasRows =
    slo.spec.min_valid_events !== undefined ||
    labels.length > 0 ||
    annotations.length > 0;
  if (!hasRows) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Definition</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="divide-y divide-border/60">
          {slo.spec.min_valid_events !== undefined && (
            <AlertingDefRow label="Min valid events">
              {slo.spec.min_valid_events}
            </AlertingDefRow>
          )}
          {labels.length > 0 && (
            <AlertingDefRow label="Labels">
              <span className="flex flex-col gap-0.5">
                {labels.map(([k, v]) => (
                  <span key={k}>
                    <span className="text-muted-foreground">{k}:</span> {v}
                  </span>
                ))}
              </span>
            </AlertingDefRow>
          )}
          {annotations.length > 0 && (
            <AlertingDefRow label="Annotations">
              <span className="flex flex-col gap-0.5">
                {annotations.map(([k, v]) => (
                  <span key={k}>
                    <span className="text-muted-foreground">{k}:</span> {v}
                  </span>
                ))}
              </span>
            </AlertingDefRow>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function AlertingSloDetailPage() {
  const { project, slug } = Route.useParams();
  const { preview } = Route.useSearch();
  const qc = useQueryClient();
  const slo = useQuery(sloQueries.sloByName(project, slug, preview));
  // Same key as the budget section's read: a cache hit, not a second request.
  const sloId = slo.data?.id;
  const status = useQuery({
    ...sloQueries.status(sloId ?? ""),
    enabled: sloId !== undefined,
  });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => {
      const id = slo.data?.id;
      if (!id) throw new Error("SLO not loaded");
      return paused
        ? resumeAlertingSlo({ data: { sloId: id } })
        : pauseAlertingSlo({ data: { sloId: id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: sloQueries.sloByName(project, slug, preview).queryKey,
      });
      // The SLOs listing shows the paused state too.
      qc.invalidateQueries({ queryKey: ["alerting", "slos"] });
      toast.success("SLO updated");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  if (slo.isError) return <AlertingQueryError error={slo.error} />;

  if (!slo.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const s = slo.data;
  const view = fromAlertingSlo(s);
  const identity = alertingSloIdentity(s);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <AlertingBackLink to="/alerts/slos" label="Back to SLOs" />
          <h2 className="text-base font-semibold">{identity.name}</h2>
          <AlertingHealthHeart status={status.data?.health.status} />
          {s.paused && <Badge variant="secondary">paused</Badge>}
          {s.spec.suppressed && (
            // Preview SLOs run evaluations but do not send notifications.
            <Badge variant="destructive">suppressed</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {view.runbookSlug && (
            <Link
              to="/runbooks/$project/$slug"
              params={{
                project: view.runbookProject ?? "default",
                slug: view.runbookSlug,
              }}
              className={cn(buttonVariants({ variant: "ghost" }))}
            >
              <BookOpenText data-icon="inline-start" />
              Runbook
            </Link>
          )}
          <AlertingPauseToggle
            paused={s.paused}
            pending={toggle.isPending}
            kind="SLO"
            name={identity.name}
            variant="outline"
            onToggle={() => toggle.mutate(s.paused)}
          />
        </div>
      </div>

      {view.displayDescription && (
        <p className="max-w-prose text-xs text-muted-foreground">
          {view.displayDescription}
        </p>
      )}

      <StatusSection slo={s} />
      <BudgetHistorySection slo={s} preview={preview} />
      <ObjectiveSection slo={s} />
    </div>
  );
}
