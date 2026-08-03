import { Badge } from "@everr/ui/components/badge";
import { buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Skeleton } from "@everr/ui/components/skeleton";
import { toneText } from "@everr/ui/components/tone";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpenText } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { ANN_LABEL_PREFIX, ANN_PROJECT } from "@/data/alerts/annotations";
import { ccEventStatus } from "@/data/alerts/event-types";
import { isReservedAnnotationKey } from "@/data/alerts/schema";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcSlo, resumeCcSlo } from "@/data/cc/server";
import {
  ccFmtWindowLabel,
  ccSloChartRange,
  ccSloCurrentBurn,
  ccSloExhaustion,
  ccSloFiringSeverity,
  ccSloHandles,
  ccSloIdentity,
  ccSloTierSeverity,
  ccSloTiers,
  ccSloWindowLabel,
  ccWorstSloGroup,
} from "@/data/cc/slo";
import type { CcSlo, CcSloGroupStatus, CcSloView } from "@/data/cc/types";
import { fromCcSlo } from "@/data/slos/mapping";
import {
  CcBudgetBar,
  ccFmtBurn,
  ccFmtFraction,
} from "./-components/budget-bar";
import {
  CcBackLink,
  CcDefRow,
  CcEmptyState,
  CcHealthHeart,
  CcPauseToggle,
  CcQueryError,
  CcSloTierBadge,
  ccErrorMessage,
  LabelSet,
} from "./-components/shared";
import {
  SloBudgetChart,
  type SloBudgetEvent,
} from "./-components/slo-budget-chart";
import { SloStatsRow } from "./-components/slo-status";
import { useCcFreshBudgets } from "./-components/use-fresh-budgets";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/slos_/$project/$slug",
)({
  // This detail route is flat (slos_), so it doesn't inherit the SLOs listing
  // crumb — emit it here so the trail reads Alerts > SLOs > <name>.
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
      ccQueries.sloByName(params.project, params.slug, deps.preview),
    );
    const range = ccSloChartRange(slo.spec);
    await Promise.all([
      queryClient.prefetchQuery(ccQueries.sloStatus(slo.id)),
      // Skipped for a spec whose window doesn't parse (nothing to chart a
      // trailing window over).
      ...(range
        ? [
            queryClient.prefetchQuery(
              ccQueries.eventHistory(range, {
                slugs: ccSloHandles(slo),
                preview: deps.preview,
              }),
            ),
            queryClient.prefetchQuery(ccQueries.sloBudgetSeries(slo.id, range)),
          ]
        : []),
    ]);
    return { name: ccSloIdentity(slo).name };
  },
  component: CcSloDetailPage,
});

// ── How's the budget ──────────────────────────────────────────────────────────

function StatusSection({ slo }: { slo: CcSlo }) {
  const status = useQuery(ccQueries.sloStatus(slo.id));
  // Read-time scan overrides the snapshot's throttled budget once it lands;
  // the snapshot renders instantly meanwhile.
  const fresh = useCcFreshBudgets([slo.id]);
  const tiers = ccSloTiers(slo.spec);

  const groupCols: Column<CcSloGroupStatus>[] = [
    {
      header: "Group",
      cell: (g) =>
        Object.keys(g.labels).length === 0 ? (
          // A scalar SLO has exactly one label-less group.
          <span className="text-xs text-muted-foreground">all traffic</span>
        ) : (
          <LabelSet labels={g.labels} />
        ),
    },
    {
      header: "SLI",
      cell: (g) => (
        <span className="font-mono text-xs tabular-nums">
          {g.sli !== null ? ccFmtFraction(g.sli) : "—"}
        </span>
      ),
    },
    {
      header: "Budget remaining",
      cell: (g) => <CcBudgetBar remaining={g.budget_remaining} />,
    },
    {
      // Headline = the shortest-long-window tier's sustained burn; the full
      // per-tier matrix lives in the tooltip.
      header: "Burn rate",
      cell: (g) => {
        const burn = ccSloCurrentBurn(tiers, g.tiers);
        if (burn === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        // Tone from real state, not projection: a spike already gone (short
        // window back to 0) must not read as burning.
        const severity = ccSloFiringSeverity(tiers, g.firing_tiers);
        const tone =
          severity === "critical"
            ? toneText({ tone: "danger", emphasis: "strong" })
            : severity !== null
              ? toneText({ tone: "warning", emphasis: "strong" })
              : (burn.effective ?? 0) >= 1
                ? toneText({ tone: "live" })
                : "text-muted-foreground";
        return (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={`font-mono text-xs tabular-nums ${tone}`} />
              }
            >
              {ccFmtBurn(burn.rate)}
              <span className="text-muted-foreground">
                {" "}
                · last {ccFmtWindowLabel(burn.window)}
              </span>
            </TooltipTrigger>
            <TooltipContent className="space-y-1.5">
              <p className="max-w-56 text-xs">
                Average burn over each alert window; 1&times; spends exactly the
                budget over {ccSloWindowLabel(slo.spec)}. A tier fires when both
                its windows reach its threshold.
              </p>
              <table className="font-mono text-[0.6875rem] tabular-nums">
                <tbody>
                  {tiers.map((t) => {
                    const snap = g.tiers.find((s) => s.name === t.name);
                    return (
                      <tr key={t.name}>
                        <td className="pr-2">{t.name}</td>
                        <td className="pr-2">
                          {snap?.long_burn_rate != null
                            ? ccFmtBurn(snap.long_burn_rate)
                            : "—"}{" "}
                          last {ccFmtWindowLabel(t.long_window)}
                        </td>
                        <td className="pr-2">
                          {snap?.short_burn_rate != null
                            ? ccFmtBurn(snap.short_burn_rate)
                            : "—"}{" "}
                          last {ccFmtWindowLabel(t.short_window)}
                        </td>
                        <td>fires &ge;{ccFmtBurn(t.burn_rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      header: "Time to exhaustion",
      cell: (g) => (
        <span className="whitespace-nowrap font-mono text-xs tabular-nums">
          {
            ccSloExhaustion(
              g.budget_remaining,
              g.time_to_exhaustion_secs,
              ccSloCurrentBurn(tiers, g.tiers)?.effective ?? null,
            ).label
          }
        </span>
      ),
    },
    {
      header: "Firing tiers",
      cell: (g) =>
        g.firing_tiers.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="flex flex-wrap gap-2">
            {g.firing_tiers.map((f) => (
              <CcSloTierBadge
                key={f.tier}
                tier={f.tier}
                severity={ccSloTierSeverity(tiers, { slo_tier: f.tier })}
                tiers={tiers}
              />
            ))}
          </span>
        ),
    },
  ];

  if (status.isError) {
    return <CcQueryError error={status.error} />;
  }
  if (status.isPending) {
    return (
      <Card>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }
  const payload = status.data?.payload ?? null;
  if (payload === null || payload.groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          {payload === null ? (
            <CcEmptyState
              title="No status snapshot yet"
              hint="The evaluator writes a snapshot on its first evaluation tick; until then there is no SLI or error budget to show."
            />
          ) : (
            <CcEmptyState
              title="No SLI groups yet"
              hint="The SLI query has not returned rows for any group in the budget window."
            />
          )}
        </CardContent>
      </Card>
    );
  }

  // Overriding budget/SLI/TTE per group can change which group is worst, so
  // merge before picking the headline.
  const groups = fresh.apply(slo, payload.groups);
  const worst = ccWorstSloGroup(tiers, groups);

  return (
    <>
      <SloStatsRow slo={slo} worst={worst} />
      {/* Keyed on the scan being in flight, not on rows returned: a quiet
          group legitimately scans to [], and a failed scan never produces
          rows; either would park this line here forever. */}
      {fresh.isPending(slo.id) && (
        <p className="px-1 text-[0.6875rem] text-muted-foreground">
          Error budget computing&hellip;
        </p>
      )}

      {/* The stats above are only the worst group's; with several groups this
          table is the rest of the answer. */}
      {groups.length > 1 && (
        <Card inset="flush-content">
          <CardHeader>
            <span className="text-xs font-medium">All groups</span>
          </CardHeader>
          <CardContent>
            <DataTable
              data={groups}
              columns={groupCols}
              rowKey={(g) => JSON.stringify(g.labels)}
            />
          </CardContent>
        </Card>
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
  slo: CcSloView;
  preview?: string;
}) {
  // Pinned to one SLO window ending now, so the rightmost point reads the
  // same span as the status hero.
  const range = ccSloChartRange(slo.spec);
  const series = useQuery({
    ...ccQueries.sloBudgetSeries(slo.id, range ?? CHART_RANGE_FALLBACK),
    enabled: range !== null,
  });
  // Scoped to this SLO's handles server-side so the row cap applies after
  // scoping: busy tenants can't push these markers out of the newest-N window.
  const events = useQuery({
    ...ccQueries.eventHistory(range ?? CHART_RANGE_FALLBACK, {
      slugs: ccSloHandles(slo),
      preview,
    }),
    enabled: range !== null,
  });
  const budgetEvents = useMemo<SloBudgetEvent[]>(() => {
    const handles = new Set(ccSloHandles(slo));
    const out: SloBudgetEvent[] = [];
    for (const e of events.data ?? []) {
      if (!handles.has(e.slug)) continue;
      const type = ccEventStatus(e.eventType);
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
          Budget remaining over a trailing {ccSloWindowLabel(slo.spec)} window.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {series.isError ? (
          <CcQueryError error={series.error} />
        ) : series.isPending ? (
          <Skeleton className="h-[240px] w-full" />
        ) : (
          <SloBudgetChart
            groups={series.data}
            epoch={slo.budget_epoch}
            events={budgetEvents}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── What is it ────────────────────────────────────────────────────────────────

function ObjectiveSection({ slo }: { slo: CcSlo }) {
  const ann = slo.spec.annotations;
  // Reserved annotations (isReservedAnnotationKey) are generated, not
  // authored, and each already has its own home on this page; only the
  // author's pass-through annotations are shown raw.
  const project = ann[ANN_PROJECT];
  const labels = Object.entries(ann)
    .filter(([k]) => k.startsWith(ANN_LABEL_PREFIX))
    .map(([k, v]) => [k.slice(ANN_LABEL_PREFIX.length), v] as const);
  const annotations = Object.entries(ann).filter(
    ([k]) => !isReservedAnnotationKey(k),
  );

  const hasRows =
    slo.spec.min_valid_events !== undefined ||
    slo.spec.sli.label_columns.length > 0 ||
    project !== undefined ||
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
            <CcDefRow label="Min valid events">
              {slo.spec.min_valid_events}
            </CcDefRow>
          )}
          {slo.spec.sli.label_columns.length > 0 && (
            <CcDefRow label="SLI groups by">
              {slo.spec.sli.label_columns.join(", ")}
            </CcDefRow>
          )}
          {project !== undefined && (
            <CcDefRow label="Project">{project}</CcDefRow>
          )}
          {labels.length > 0 && (
            <CcDefRow label="Labels">
              <span className="flex flex-col gap-0.5">
                {labels.map(([k, v]) => (
                  <span key={k}>
                    <span className="text-muted-foreground">{k}:</span> {v}
                  </span>
                ))}
              </span>
            </CcDefRow>
          )}
          {annotations.length > 0 && (
            <CcDefRow label="Annotations">
              <span className="flex flex-col gap-0.5">
                {annotations.map(([k, v]) => (
                  <span key={k}>
                    <span className="text-muted-foreground">{k}:</span> {v}
                  </span>
                ))}
              </span>
            </CcDefRow>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function CcSloDetailPage() {
  const { project, slug } = Route.useParams();
  const { preview } = Route.useSearch();
  const qc = useQueryClient();
  const slo = useQuery(ccQueries.sloByName(project, slug, preview));
  // Same key as the budget section's read: a cache hit, not a second request.
  const sloId = slo.data?.id;
  const status = useQuery({
    ...ccQueries.sloStatus(sloId ?? ""),
    enabled: sloId !== undefined,
  });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => {
      const id = slo.data?.id;
      if (!id) throw new Error("SLO not loaded");
      return paused
        ? resumeCcSlo({ data: { sloId: id } })
        : pauseCcSlo({ data: { sloId: id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ccQueries.sloByName(project, slug, preview).queryKey,
      });
      // The SLOs listing shows the paused state too.
      qc.invalidateQueries({ queryKey: ["cc", "slos"] });
      toast.success("SLO updated");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  if (slo.isError) return <CcQueryError error={slo.error} />;

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
  const view = fromCcSlo(s);
  const identity = ccSloIdentity(s);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <CcBackLink to="/alerts/slos" label="Back to SLOs" />
          <h2 className="text-base font-semibold">{identity.name}</h2>
          <CcHealthHeart status={status.data?.health.status} />
          {s.paused && <Badge variant="secondary">paused</Badge>}
          {s.spec.suppressed && (
            // Evaluates fully but never notifies — worth a loud flag.
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
          <CcPauseToggle
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
