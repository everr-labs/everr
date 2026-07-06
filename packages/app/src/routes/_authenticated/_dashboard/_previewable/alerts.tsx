import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import type { Column } from "@everr/ui/components/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Textarea } from "@everr/ui/components/textarea";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { cn } from "@everr/ui/lib/utils";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  stripSearchParams,
  useSearch,
} from "@tanstack/react-router";
import {
  BellOff,
  ChevronDown,
  ChevronRight,
  NotebookText,
  Plus,
  SearchIcon,
  Settings,
  XIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { z } from "zod";
import { AlertEventFeed } from "@/components/cc/alert-event-feed";
import { MatchersEditor } from "@/components/cc/matchers-editor";
import { computeNotifiesChannels, joinWithAnd } from "@/components/cc/notifies";
import { ccMatcherMatches } from "@/components/cc/route-resolution";
import {
  CcStatusDot,
  Conditions,
  ccFormatTs,
  LabelSet,
} from "@/components/cc/shared";
import { PreviewStatusBadge } from "@/components/preview-status-badge";
import { formatRunbookRef } from "@/data/alerts/schema";
import {
  type AlertSummary,
  createSilence,
  getAlertSettings,
  listAlerts,
  RULE_LABEL,
} from "@/data/alerts/server";
import {
  createCcSilence,
  deleteCcSilence,
  listCcAlerts,
  listCcRoutes,
  listCcSilences,
} from "@/data/cc/server";
import type { CcAlert, CcMatcher, CcSilence } from "@/data/cc/types";
import { useCcInvalidation } from "@/hooks/use-cc-invalidation";
import {
  AlertStateBadges,
  formatInterval,
  isCustomHoursInvalid,
  isEvaluationStale,
  MuteDurationFieldset,
  muteEndFromHours,
  QueryErrorMessage,
  RelativeTime,
  SeverityBadge,
} from "./-alerts-shared";

const alertsQueryOptions = (preview?: string) =>
  queryOptions({
    // Keyed under the shared "alerts" prefix so mutation invalidations hit
    // every preview variant of the list.
    queryKey: ["alerts", "list", preview ?? ""],
    queryFn: () => listAlerts({ data: { preview } }),
  });

// Exported so the /alerts/notifications page's settings form reads and
// invalidates the exact same cache entry as this list's "no channels" banner.
export const alertSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["alerts", "settings"],
    queryFn: () => getAlertSettings(),
  });

// Grouped under the CC-native "cc" prefix (not "alerts") so the CC event
// stream's own invalidation wave (CC_INVALIDATION_KEYS) refreshes them too.
const ccAlertInstancesQueryOptions = () =>
  queryOptions({ queryKey: ["cc", "alerts"], queryFn: () => listCcAlerts() });

const ccSilencesQueryOptions = () =>
  queryOptions({
    queryKey: ["cc", "silences"],
    queryFn: () => listCcSilences(),
  });

// Same cache key alerts_.$alertId.tsx/route-builder.tsx/notifications.tsx use,
// so a route created/edited there is reflected here without a page reload.
// Only fetched in the flat firing view, which is the only place this page
// resolves Notifies per instance.
const ccRoutesQueryOptions = () =>
  queryOptions({ queryKey: ["cc", "routes"], queryFn: () => listCcRoutes() });

function isActiveMute(silence: CcSilence, now: number = Date.now()) {
  const starts = new Date(silence.starts_at).getTime();
  const ends = new Date(silence.ends_at).getTime();
  return starts <= now && now < ends;
}

// Client-side approximation of "does this active mute apply to this
// instance", not a full replica of alertmanager's route/group semantics —
// enough for a "muted" hint in the flat, org-wide view. The matchers are
// partitioned because instance labels never carry the synthetic RULE_LABEL
// key (naively ANDing every matcher against the labels would match nothing):
// any RULE_LABEL matcher must pin this instance's rule id, AND every
// remaining condition must match the instance's labels. `createSilence`
// stamps RULE_LABEL ALONGSIDE the instance's label conditions, so a mute
// created from one label set badges only that set; a RULE_LABEL-only mute
// (no other conditions) mutes every label set of the rule.
function ccSilenceMatchesInstance(
  silence: CcSilence,
  ruleId: string,
  labels: Record<string, string>,
): boolean {
  const ruleScoped = silence.matchers.every(
    (m) => m.label !== RULE_LABEL || (m.op === "eq" && m.value === ruleId),
  );
  return (
    ruleScoped &&
    silence.matchers
      .filter((m) => m.label !== RULE_LABEL)
      .every((m) => ccMatcherMatches(m, labels))
  );
}

// A rule-scoped mute defaults to this window; the alerts list keeps things
// short-lived rather than open-ended (a longer mute belongs in the CC monitor
// silences view, which lets the author pick a window).
const MUTE_DURATION_MS = 2 * 60 * 60 * 1000;

const AlertsSearchSchema = z.object({
  view: z.enum(["alerts", "activity"]).catch("alerts").default("alerts"),
});

const ALERTS_VIEW_TABS: { value: "alerts" | "activity"; label: string }[] = [
  { value: "alerts", label: "Alerts" },
  { value: "activity", label: "Activity" },
];

type AlertListFilter =
  | "all"
  | "firing"
  | "degraded"
  | "silenced"
  | "resolved"
  | "inactive";

interface AlertFilterOption {
  value: AlertListFilter;
  label: string;
  count: number;
  tone?: "destructive" | "warning";
}

function alertMatchesFilter(alert: AlertSummary, filter: AlertListFilter) {
  switch (filter) {
    case "all":
      return true;
    case "firing":
      return alert.active && alert.currentState === "firing";
    case "degraded":
      return alert.active && alert.health !== "healthy";
    case "silenced":
      return alert.activeSilenceCount > 0;
    case "resolved":
      return alert.active && alert.currentState === "resolved";
    case "inactive":
      return !alert.active;
  }
}

// The health dot's tooltip: always names checks-every (the baseline cadence),
// and, once degraded, layers in the diagnostic facts (consecutive failures,
// last error, when it last failed) that explain why. Recency is sourced
// honestly per state: while degraded, `healthLastErrorAt` — CC stamps it on
// every failed attempt, whereas `lastSeenAt` (rollup.last_seen_at) only
// advances when the query returns rows and freezes mid-streak; while healthy,
// `lastSeenAt` labeled as "last active" (activity-gated, not eval-gated).
function healthTooltip(alert: AlertSummary): string {
  const checksEvery = `checks every ${formatInterval(alert.evaluationIntervalSeconds)}`;
  if (alert.health === "healthy") {
    const parts = ["Healthy"];
    if (alert.lastSeenAt) {
      parts.push(`last active ${formatRelativeTime(alert.lastSeenAt)}`);
    }
    parts.push(checksEvery);
    return parts.join(" · ");
  }
  const failures = alert.healthConsecutiveFailures;
  const parts = [
    `Degraded · ${failures} consecutive ${failures === 1 ? "failure" : "failures"}`,
  ];
  if (alert.healthError) parts.push(`last error: ${alert.healthError}`);
  if (alert.healthLastErrorAt) {
    parts.push(`last failed ${formatRelativeTime(alert.healthLastErrorAt)}`);
  }
  parts.push(checksEvery);
  return parts.join(" · ");
}

function alertMatchesSearch(alert: AlertSummary, query: string) {
  if (!query) return true;
  return [
    alert.displayName,
    alert.slug,
    alert.repoid,
    alert.runbookProject,
    alert.runbookSlug,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function AlertFilterButton({
  option,
  active,
  onSelect,
}: {
  option: AlertFilterOption;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "h-6 gap-1.5 rounded-md px-1.5 text-[0.6875rem] transition-colors",
        active
          ? "border-border bg-muted/70 text-foreground shadow-none hover:bg-muted"
          : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
        active &&
          option.tone === "destructive" &&
          "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15",
        active &&
          option.tone === "warning" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400",
      )}
    >
      <span className="font-medium">{option.label}</span>
      <span
        className={cn(
          "inline-flex min-w-4 items-center justify-center rounded-sm px-1 font-semibold tabular-nums",
          active ? "bg-background/70" : "bg-muted/50 text-foreground",
          active &&
            option.tone === "destructive" &&
            "bg-destructive/15 text-destructive",
          active &&
            option.tone === "warning" &&
            "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        )}
      >
        {option.count}
      </span>
    </Button>
  );
}

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts",
)({
  staticData: { breadcrumb: "Alerts", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  validateSearch: AlertsSearchSchema,
  // Keeps the default tab ("alerts") out of the URL; only a non-default view
  // shows up as `?view=activity`. The app-wide `preview` param lives (and is
  // retained across navigation) on the parent `_dashboard` route, untouched
  // here.
  search: {
    middlewares: [stripSearchParams(AlertsSearchSchema.parse({}))],
  },
  // Preview is app-wide search state; declaring it as a loader dep keys the
  // prefetch to the same preview the component reads, so switching previews
  // refetches instead of serving the wrong overlay.
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: async ({ context: { queryClient }, deps: { preview } }) => {
    await Promise.all([
      queryClient.prefetchQuery(alertsQueryOptions(preview)),
      queryClient.prefetchQuery(alertSettingsQueryOptions()),
    ]);
  },
  component: AlertsPage,
});

function AlertsPage() {
  useCcInvalidation();
  const { view } = Route.useSearch();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  const queryClient = useQueryClient();
  const alerts = useQuery(alertsQueryOptions(preview));
  const settings = useQuery(alertSettingsQueryOptions());
  const [alertFilter, setAlertFilter] = useState<AlertListFilter>("all");
  const [alertSearch, setAlertSearch] = useState("");

  // Mutes pill + panel: org-wide active silences, fetched unconditionally
  // (independent of which alerts are firing).
  const mutes = useQuery(ccSilencesQueryOptions());
  const activeMutes = useMemo(
    () => (mutes.data ?? []).filter((m) => isActiveMute(m)),
    [mutes.data],
  );
  const [mutesOpen, setMutesOpen] = useState(false);
  const [newMuteOpen, setNewMuteOpen] = useState(false);
  const cancelMute = useMutation({
    mutationFn: (id: string) => deleteCcSilence({ data: { id } }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cc", "silences"] }),
        // Cancelling a rule-scoped mute changes that rule's mute count.
        queryClient.invalidateQueries({ queryKey: ["alerts"] }),
      ]),
  });

  // Expandable firing rows: org alert instances, grouped by rule id, fetched
  // only when at least one rule is currently firing (nothing to show
  // otherwise). Local expansion state is keyed by rule id, never synced from
  // props/query data.
  const hasFiringAlerts = (alerts.data ?? []).some(
    (a) => a.currentState === "firing",
  );
  const instances = useQuery({
    ...ccAlertInstancesQueryOptions(),
    enabled: hasFiringAlerts,
  });
  const firingInstancesByRule = useMemo(() => {
    const map = new Map<string, CcAlert[]>();
    for (const instance of instances.data ?? []) {
      if (instance.status !== "firing") continue;
      const existing = map.get(instance.rule);
      if (existing) existing.push(instance);
      else map.set(instance.rule, [instance]);
    }
    return map;
  }, [instances.data]);

  // Flat firing view: one row per active label set across every rule (the
  // old cc-alerting monitor/active page's org-wide table), toggled in as an
  // alternative to the grouped-by-rule list above. Component state, not a
  // search param — this is a transient viewing preference, not shareable
  // navigation state.
  const [firingViewMode, setFiringViewMode] = useState<"grouped" | "flat">(
    "grouped",
  );
  const allFiringInstances = useMemo(
    () => (instances.data ?? []).filter((i) => i.status === "firing"),
    [instances.data],
  );
  const showFiringViewToggle =
    alertFilter === "firing" && allFiringInstances.length > 0;
  // Only the flat view resolves Notifies per instance, so the routes list is
  // fetched lazily rather than unconditionally on every alerts-home visit.
  const routes = useQuery({
    ...ccRoutesQueryOptions(),
    enabled: alertFilter === "firing" && firingViewMode === "flat",
  });
  const flatFiringRows = useMemo(() => {
    const alertsById = new Map(alerts.data?.map((a) => [a.id, a]));
    return allFiringInstances.map((instance) => {
      const alert = alertsById.get(instance.rule);
      return {
        key: instance.key,
        ruleId: instance.rule,
        displayName: alert?.displayName || alert?.slug || instance.rule,
        // Same feel as the grouped list's search: the alert's name and slug,
        // plus this row's own label values (its distinguishing facts here).
        searchText: [
          alert?.displayName,
          alert?.slug,
          ...Object.values(instance.labels),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        labels: instance.labels,
        value: instance.value,
        activeSince: instance.active_since,
        muted: activeMutes.some((mute) =>
          ccSilenceMatchesInstance(mute, instance.rule, instance.labels),
        ),
        notifies: computeNotifiesChannels({
          delivery: settings.data?.delivery,
          routes: routes.data ?? [],
          labelSets: [instance.labels],
        }),
      };
    });
  }, [
    allFiringInstances,
    alerts.data,
    activeMutes,
    settings.data,
    routes.data,
  ]);
  const flatSearchQuery = alertSearch.trim().toLowerCase();
  const filteredFlatRows = useMemo(
    () =>
      flatSearchQuery
        ? flatFiringRows.filter((row) =>
            row.searchText.includes(flatSearchQuery),
          )
        : flatFiringRows,
    [flatFiringRows, flatSearchQuery],
  );
  const flatViewActive = showFiringViewToggle && firingViewMode === "flat";

  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleExpanded = (ruleId: string) => {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };
  // Rule-scoped mute (same server fn as the detail page's mute flow, admin
  // gated there too): `createSilence` stamps the synthetic rule matcher
  // server-side, so the mute stays scoped to this rule — raw label conditions
  // alone could mute OTHER rules sharing those labels — and shows up in the
  // rule's own mute count on the list.
  const muteInstance = useMutation({
    mutationFn: (instance: CcAlert) =>
      createSilence({
        data: {
          alertId: instance.rule,
          matchers: Object.entries(instance.labels).map(([label, value]) => ({
            label,
            op: "=" as const,
            value,
          })),
          endsAt: new Date(Date.now() + MUTE_DURATION_MS).toISOString(),
          reason: "Muted from alerts list",
        },
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cc", "silences"] }),
        // The rule's activeSilenceCount ("muted" chip) reads from listAlerts.
        queryClient.invalidateQueries({ queryKey: ["alerts"] }),
      ]),
  });

  const summary = useMemo(() => {
    let firing = 0;
    let degraded = 0;
    let resolved = 0;
    let inactive = 0;
    let silenced = 0;
    for (const a of alerts.data ?? []) {
      if (a.activeSilenceCount > 0) silenced += 1;
      if (!a.active) inactive += 1;
      else {
        if (a.health !== "healthy") degraded += 1;
        if (a.currentState === "firing") firing += 1;
        else if (a.currentState === "resolved") resolved += 1;
      }
    }
    return {
      total: alerts.data?.length ?? 0,
      firing,
      degraded,
      resolved,
      inactive,
      silenced,
    };
  }, [alerts.data]);

  const filterOptions = useMemo<AlertFilterOption[]>(() => {
    const all: AlertFilterOption[] = [
      { value: "all", label: "All", count: summary.total },
      {
        value: "firing",
        label: "Firing",
        count: summary.firing,
        tone: "destructive",
      },
      {
        value: "degraded",
        label: "Degraded",
        count: summary.degraded,
        tone: "warning",
      },
      { value: "silenced", label: "Muted", count: summary.silenced },
      { value: "resolved", label: "Resolved", count: summary.resolved },
      { value: "inactive", label: "Inactive", count: summary.inactive },
    ];
    // Hide empty categories, but always keep "All" and whichever chip is the
    // active filter (so the current selection never vanishes from the row).
    return all.filter(
      (o) => o.value === "all" || o.count > 0 || o.value === alertFilter,
    );
  }, [alertFilter, summary]);

  const filteredAlerts = useMemo(() => {
    const query = alertSearch.trim().toLowerCase();
    return (alerts.data ?? []).filter(
      (alert) =>
        alertMatchesFilter(alert, alertFilter) &&
        alertMatchesSearch(alert, query),
    );
  }, [alertFilter, alertSearch, alerts.data]);
  const hasActiveListFilters =
    alertFilter !== "all" || alertSearch.trim().length > 0;
  const clearAlertFilters = () => {
    setAlertFilter("all");
    setAlertSearch("");
  };

  const delivery = settings.data?.delivery;
  const hasChannel =
    !!delivery &&
    ((delivery.email.enabled && delivery.email.to.length > 0) ||
      (delivery.telegram.enabled &&
        delivery.telegram.chatIds.length > 0 &&
        delivery.telegram.botToken.length > 0) ||
      (delivery.slack.enabled && delivery.slack.webhookUrl.length > 0));

  const columns = useMemo<Column<AlertSummary>[]>(
    () => [
      {
        header: "Health",
        cell: (row) => (
          <span title={healthTooltip(row)} className="inline-flex items-center">
            <CcStatusDot
              tone={row.health === "healthy" ? "healthy" : "degraded"}
            />
          </span>
        ),
      },
      {
        header: "Alert",
        cell: (row) => (
          <span className="flex items-center gap-2">
            <Link
              to="/alerts/$alertId"
              params={{ alertId: row.id }}
              className="min-w-0 underline-offset-4 hover:underline"
            >
              {row.displayName ? (
                <span className="flex items-baseline gap-2">
                  <span className="font-medium">{row.displayName}</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {row.slug}
                  </span>
                </span>
              ) : (
                <span className="font-mono">{row.slug}</span>
              )}
            </Link>
            <PreviewStatusBadge status={row.previewStatus} />
          </span>
        ),
      },
      {
        header: "State",
        cell: (row) => (
          <AlertStateBadges
            state={row.currentState}
            active={row.active}
            firingInstanceCount={row.firingInstanceCount}
            activeSilenceCount={row.activeSilenceCount}
            activeSilenceExpiresAt={row.activeSilenceExpiresAt}
          />
        ),
      },
      {
        header: "Severity",
        cell: (row) => <SeverityBadge severity={row.severity} />,
      },
      {
        header: "Last seen",
        cell: (row) => {
          const stale = isEvaluationStale(
            row.lastSeenAt,
            row.evaluationIntervalSeconds,
          );
          return (
            <span className="flex items-center gap-1.5">
              <span className={stale ? "text-amber-500" : undefined}>
                <RelativeTime value={row.lastSeenAt} />
              </span>
              {stale && (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 text-amber-500"
                  title="Evaluation overdue — this rule hasn't run recently"
                >
                  overdue
                </Badge>
              )}
            </span>
          );
        },
      },
      {
        header: "Firing since",
        cell: (row) =>
          row.currentState === "firing" ? (
            <RelativeTime value={row.lastFiredAt} />
          ) : (
            "—"
          ),
      },
      {
        header: "Interval",
        cell: (row) => formatInterval(row.evaluationIntervalSeconds),
      },
      {
        header: "Runbook",
        cell: (row) =>
          row.runbookProject && row.runbookSlug ? (
            <Link
              to="/runbooks/$project/$slug"
              params={{ project: row.runbookProject, slug: row.runbookSlug }}
              className="inline-flex items-center text-muted-foreground hover:text-foreground"
              title={formatRunbookRef(row.runbookProject, row.runbookSlug)}
              onClick={(e) => e.stopPropagation()}
            >
              <NotebookText className="size-4" />
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [],
  );

  const alertsEmptyState = hasActiveListFilters ? (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-muted-foreground">
      <p>No alerts match these filters.</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={clearAlertFilters}
      >
        <XIcon data-icon="inline-start" />
        Clear filters
      </Button>
    </div>
  ) : (
    <div className="px-3 py-8 text-center text-muted-foreground">
      <p>No alerts have been applied for this organization.</p>
      <p className="mt-1">
        <a
          className="underline underline-offset-4"
          href="https://everr.dev/docs/alerts/first-alert"
          target="_blank"
          rel="noreferrer"
        >
          Create your first alert
        </a>
      </p>
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Alerts</h1>
          <p className="text-muted-foreground">
            Alert rules applied for this organization.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={mutesOpen} onOpenChange={setMutesOpen}>
            <PopoverTrigger
              render={<Button type="button" variant="outline" size="sm" />}
            >
              <BellOff data-icon="inline-start" />
              {activeMutes.length > 0
                ? `${activeMutes.length} ${activeMutes.length === 1 ? "mute" : "mutes"} active`
                : "Mutes"}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <PopoverHeader className="flex-row items-center justify-between gap-2">
                <PopoverTitle>Active mutes</PopoverTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMutesOpen(false);
                    setNewMuteOpen(true);
                  }}
                >
                  <Plus data-icon="inline-start" />
                  New mute
                </Button>
              </PopoverHeader>
              {activeMutes.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {activeMutes.map((mute) => (
                    <li
                      key={mute.id}
                      className="flex flex-col gap-1.5 rounded-md border border-border/60 px-2.5 py-2"
                    >
                      <Conditions
                        matchers={mute.matchers.filter(
                          (m) => m.label !== RULE_LABEL,
                        )}
                      />
                      <div className="flex items-center justify-between gap-2 text-muted-foreground">
                        <span>until {ccFormatTs(mute.ends_at)}</span>
                        {mute.comment && (
                          <span className="truncate">{mute.comment}</span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={
                          cancelMute.isPending &&
                          cancelMute.variables === mute.id
                        }
                        onClick={() => cancelMute.mutate(mute.id)}
                      >
                        Cancel
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No mutes active.
                </p>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/alerts/notifications" />}
          >
            <Settings data-icon="inline-start" />
            Notifications
          </Button>
        </div>
      </div>

      <StandaloneMuteDialog
        open={newMuteOpen}
        onClose={() => setNewMuteOpen(false)}
      />

      <div
        role="tablist"
        aria-label="Alerts view"
        className="inline-flex w-fit rounded-md border border-border bg-muted/20 p-0.5"
      >
        {ALERTS_VIEW_TABS.map((tab) => {
          const active = view === tab.value;
          return (
            <Link
              key={tab.value}
              to="/alerts"
              search={(prev) => ({ ...prev, view: tab.value })}
              role="tab"
              aria-selected={active}
              className={cn(
                "rounded-[0.3rem] px-3 py-1 text-xs font-medium outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] focus-visible:outline-primary",
                active
                  ? "bg-card text-foreground ring-1 ring-foreground/10"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {view === "activity" ? (
        <AlertEventFeed />
      ) : (
        <>
          {settings.data && !hasChannel && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              No notification channels are configured, so firing alerts won't
              reach anyone.{" "}
              <Link
                to="/alerts/notifications"
                className="font-medium underline underline-offset-4"
              >
                Configure notifications
              </Link>
              .
            </div>
          )}

          {alerts.data && alerts.data.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <fieldset className="flex flex-wrap items-center gap-1.5">
                <legend className="sr-only">Alert summary filters</legend>
                {filterOptions.map((option) => (
                  <AlertFilterButton
                    key={option.value}
                    option={option}
                    active={alertFilter === option.value}
                    onSelect={() => setAlertFilter(option.value)}
                  />
                ))}
              </fieldset>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-sm">
                  <SearchIcon className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search alerts"
                    placeholder="Search alerts..."
                    value={alertSearch}
                    onChange={(e) => setAlertSearch(e.target.value)}
                    className="h-7 rounded-lg border-border/70 bg-transparent pl-7 text-xs placeholder:text-muted-foreground/80 hover:bg-muted/20 focus-visible:bg-background"
                  />
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <span>
                    {flatViewActive
                      ? `Showing ${filteredFlatRows.length} of ${flatFiringRows.length}`
                      : hasActiveListFilters
                        ? `Showing ${filteredAlerts.length} of ${summary.total}`
                        : `${summary.total} alert ${summary.total === 1 ? "rule" : "rules"}`}
                  </span>
                  {hasActiveListFilters && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearAlertFilters}
                    >
                      <XIcon data-icon="inline-start" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {showFiringViewToggle && (
            <div
              role="tablist"
              aria-label="Firing view"
              className="inline-flex w-fit rounded-md border border-border bg-muted/20 p-0.5"
            >
              {(
                [
                  { value: "grouped", label: "Group by alert" },
                  { value: "flat", label: "Flat" },
                ] as const
              ).map((tab) => {
                const active = firingViewMode === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFiringViewMode(tab.value)}
                    className={cn(
                      "rounded-[0.3rem] px-3 py-1 text-xs font-medium outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] focus-visible:outline-primary",
                      active
                        ? "bg-card text-foreground ring-1 ring-foreground/10"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}

          <Card inset="flush-content">
            <CardContent>
              {flatViewActive ? (
                <FlatFiringTable
                  rows={filteredFlatRows}
                  searchActive={flatSearchQuery.length > 0}
                  isLoading={instances.isPending}
                  isError={instances.isError}
                />
              ) : alerts.isError ? (
                <QueryErrorMessage message="Unable to load alerts." />
              ) : alerts.isPending ? (
                <div className="flex flex-col gap-2 px-3 py-2">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-8 w-full" />
                  ))}
                </div>
              ) : filteredAlerts.length === 0 ? (
                alertsEmptyState
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="w-8 pb-2 pl-3">
                          <span className="sr-only">Expand</span>
                        </th>
                        {columns.map((col, i) => (
                          <th
                            key={i}
                            className={cn(
                              "whitespace-nowrap pb-2",
                              i !== columns.length - 1 && "pr-4",
                              i === columns.length - 1 && "pr-3",
                            )}
                          >
                            {col.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAlerts.map((alert) => {
                        const canExpand = alert.currentState === "firing";
                        const expanded =
                          canExpand && expandedRuleIds.has(alert.id);
                        return (
                          <Fragment key={alert.id}>
                            <tr
                              className={cn(
                                "border-b last:border-0 hover:bg-muted/50",
                                alert.previewStatus === "removed" &&
                                  "opacity-50",
                              )}
                            >
                              <td className="py-2 pl-3">
                                {canExpand && (
                                  <button
                                    type="button"
                                    aria-expanded={expanded}
                                    aria-label={
                                      expanded
                                        ? `Collapse firing detail for ${alert.slug}`
                                        : `Expand firing detail for ${alert.slug}`
                                    }
                                    onClick={() => toggleExpanded(alert.id)}
                                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    {expanded ? (
                                      <ChevronDown className="size-3.5" />
                                    ) : (
                                      <ChevronRight className="size-3.5" />
                                    )}
                                  </button>
                                )}
                              </td>
                              {columns.map((col, i) => (
                                <td
                                  key={i}
                                  className={cn(
                                    "py-2",
                                    i !== columns.length - 1 && "pr-4",
                                    i === columns.length - 1 && "pr-3",
                                  )}
                                >
                                  {col.cell(alert)}
                                </td>
                              ))}
                            </tr>
                            {expanded && (
                              <tr className="border-b bg-muted/10 last:border-0">
                                <td
                                  colSpan={columns.length + 1}
                                  className="p-0"
                                >
                                  <FiringRowDetail
                                    instances={
                                      firingInstancesByRule.get(alert.id) ?? []
                                    }
                                    isLoading={instances.isPending}
                                    isError={instances.isError}
                                    onMute={(instance) =>
                                      muteInstance.mutate(instance)
                                    }
                                    mutingKey={
                                      muteInstance.isPending
                                        ? muteInstance.variables?.key
                                        : undefined
                                    }
                                    checksEverySeconds={
                                      alert.evaluationIntervalSeconds
                                    }
                                    lastActiveAt={alert.lastSeenAt}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat firing view: one row per active label set across every rule, restoring
// the old cc-alerting monitor/active page's org-wide table as a toggle on the
// Firing filter.
// ---------------------------------------------------------------------------

type FlatFiringRow = {
  key: string;
  ruleId: string;
  displayName: string;
  labels: Record<string, string>;
  value: number | null;
  activeSince: string | null;
  muted: boolean;
  notifies: string[];
};

function FlatFiringTable({
  rows,
  searchActive,
  isLoading,
  isError,
}: {
  rows: FlatFiringRow[];
  searchActive: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isError) {
    return <QueryErrorMessage message="Unable to load firing detail." />;
  }
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-muted-foreground">
        {searchActive
          ? "No firing label sets match this search."
          : "No label sets are firing right now."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="whitespace-nowrap pb-2 pl-3 pr-4">Alert</th>
            <th className="whitespace-nowrap pb-2 pr-4">Labels</th>
            <th className="whitespace-nowrap pb-2 pr-4">Value</th>
            <th className="whitespace-nowrap pb-2 pr-4">Since</th>
            <th className="whitespace-nowrap pb-2 pr-3">Notifies</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b last:border-0 hover:bg-muted/50"
            >
              <td className="py-2 pl-3 pr-4">
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/alerts/$alertId"
                    params={{ alertId: row.ruleId }}
                    className="min-w-0 font-medium underline-offset-4 hover:underline"
                  >
                    {row.displayName}
                  </Link>
                  {row.muted && <Badge variant="secondary">muted</Badge>}
                </span>
              </td>
              <td className="py-2 pr-4">
                <LabelSet labels={row.labels} />
              </td>
              <td className="py-2 pr-4 tabular-nums">{row.value ?? "—"}</td>
              <td className="py-2 pr-4">
                <RelativeTime value={row.activeSince} />
              </td>
              <td className="py-2 pr-3">
                {row.notifies.length > 0 ? (
                  <span>{joinWithAnd(row.notifies)}</span>
                ) : (
                  <span className="text-muted-foreground">
                    No channels configured
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FiringRowDetail({
  instances,
  isLoading,
  isError,
  onMute,
  mutingKey,
  checksEverySeconds,
  lastActiveAt,
}: {
  instances: CcAlert[];
  isLoading: boolean;
  isError: boolean;
  onMute: (instance: CcAlert) => void;
  mutingKey?: string;
  checksEverySeconds: number;
  lastActiveAt: string | null;
}) {
  if (isError) {
    return (
      <p className="px-3 py-3 text-xs text-destructive" role="alert">
        Unable to load firing detail.
      </p>
    );
  }
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 px-3 py-3">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>checks every {formatInterval(checksEverySeconds)}</span>
        {/* "last active", not "last evaluated": rollup.last_seen_at only
            advances when the query returns rows, so it measures activity,
            not evaluation attempts. */}
        <span>
          last active <RelativeTime value={lastActiveAt} />
        </span>
      </div>
      {instances.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No firing instances reported.
        </p>
      )}
      {instances.map((instance) => (
        <div
          key={instance.key}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
        >
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Firing on</span>
            <LabelSet labels={instance.labels} />
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="tabular-nums">value {instance.value ?? "—"}</span>
            <span>
              since <RelativeTime value={instance.active_since} />
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={mutingKey === instance.key}
            onClick={() => onMute(instance)}
          >
            <BellOff data-icon="inline-start" />
            Mute
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standalone mutes: a raw-conditions, org-wide mute not scoped to any one
// rule (the old cc-alerting monitor/silences page's capability). This is
// deliberately the one legitimate call site for createCcSilence's raw
// matchers in this app: a standalone org-wide mute, matching any instance
// (of any rule) whose labels satisfy the conditions, e.g. "mute
// namespace=staging for 2h before a deploy." Every other mute action in this
// app (row/rule mute buttons, the detail page's mute dialog) goes through the
// rule-scoped `createSilence`, which stamps its own synthetic rule matcher so
// the mute can't bleed into other rules that happen to share those labels.
// ---------------------------------------------------------------------------

function StandaloneMuteDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [matchers, setMatchers] = useState<CcMatcher[]>([]);
  const [duration, setDuration] = useState<string>("1");
  const [customHours, setCustomHours] = useState("2");
  const [reason, setReason] = useState("");

  function reset() {
    setMatchers([]);
    setDuration("1");
    setCustomHours("2");
    setReason("");
  }

  const effectiveHours = duration === "custom" ? customHours : duration;
  const customHoursInvalid = isCustomHoursInvalid(duration, customHours);
  // Only complete rows (label AND value both non-blank) count toward the
  // "at least one condition" gate, and only they are sent. An in-progress row
  // with a blank value is not a narrower condition — it's a broader one:
  // blank-value `ne` matches virtually every instance (a label that isn't ""
  // or is absent), and blank-value `regex` matches any instance carrying the
  // label. The editor offers no valueless op, so there is no legitimate
  // blank-value condition to preserve.
  const conditions = matchers.filter(
    (m) => m.label.trim() !== "" && m.value.trim() !== "",
  );

  const create = useMutation({
    mutationFn: () =>
      createCcSilence({
        data: {
          matchers: conditions,
          starts_at: new Date().toISOString(),
          ends_at: muteEndFromHours(effectiveHours).toISOString(),
          comment: reason || undefined,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cc", "silences"] });
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      onClose();
      reset();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(dialogOpen) => {
        if (!dialogOpen) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New mute</DialogTitle>
          <DialogDescription>
            Mutes any firing instance, from any rule, whose labels satisfy these
            conditions until the window ends. Evaluation continues.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <MatchersEditor value={matchers} onChange={setMatchers} />
          <MuteDurationFieldset
            duration={duration}
            onDurationChange={setDuration}
            customHours={customHours}
            onCustomHoursChange={setCustomHours}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="standalone-mute-reason">
              Reason{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="standalone-mute-reason"
              placeholder="Why mute these alerts?"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {create.error && (
            <p className="text-sm text-destructive" role="alert">
              {create.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              reset();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={
              create.isPending || conditions.length === 0 || customHoursInvalid
            }
            onClick={() => create.mutate()}
          >
            <BellOff data-icon="inline-start" />
            Create mute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
