// The triage board: source groups, each with expandable instance rows carrying
// evidence, delivery, and the act-on-it controls. It shows every instance
// unfiltered — triage means seeing the whole picture at once, not flipping
// between views of it — and the counts by state live in the pipeline strip
// above. The board owns the UI state and the quick-silence mutation that only
// it uses. What it takes from the route is the resolved data, plus one callback
// for the custom-silence drawer, which the route shares with the silences panel
// below.

import { Button, buttonVariants } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellOff, BookOpenText, ChevronRight, FileSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ccFmtBurn } from "@/components/cc/budget-bar";
import {
  CcInstanceStatusBadge,
  CcSeverityBadge,
  CcSloTierBadge,
  CcStatusDot,
  CcTableSkeleton,
  Conditions,
  ccErrorMessage,
  ccFormatTs,
  EvidenceChips,
  LabelSet,
  Pill,
} from "@/components/cc/shared";
import { ccEventStatus } from "@/data/alerts/event-types";
import { fromCcRule } from "@/data/alerts/mapping";
import { parseResourceName } from "@/data/as-code/identity";
import { ccQueries } from "@/data/cc/queries";
import { createCcSilence } from "@/data/cc/server";
import {
  ccInstanceLogsSearch,
  ccRunbookParams,
  ccSloInstanceSeverity,
  ccSourceScopedSilenceMatchers,
  TRIAGE_EVENT_RANGE,
  type TriageGroup,
  type TriageInstance,
} from "@/data/cc/triage";
import type { CcAlert, CcMatcher, CcRoute } from "@/data/cc/types";

// Per-instance cap for the expanded row's fingerprint-scoped feed: it needs
// the newest evidence-carrying event plus the last 6 transitions, so this is
// generous headroom.
const TRIAGE_INSTANCE_EVENT_LIMIT = 100;

// ── Delivery fact ─────────────────────────────────────────────────────────────

function DeliveryFact({
  matchedRoutes,
  channelsByReceiver,
  hasSubscribers,
}: {
  matchedRoutes: CcRoute[];
  channelsByReceiver: Map<string, string[]>;
  hasSubscribers: boolean;
}) {
  if (matchedRoutes.length === 0) {
    return (
      <Link
        to="/alerts/delivery"
        hash="firehose"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "whitespace-nowrap text-xs underline-offset-2 hover:underline",
          toneText({ tone: "warning" }),
        )}
      >
        {hasSubscribers
          ? "not routed · firehose only"
          : "not routed · no subscribers"}
      </Link>
    );
  }
  const receiverNames = [...new Set(matchedRoutes.map((r) => r.receiver))];
  const channels = [
    ...new Set(receiverNames.flatMap((n) => channelsByReceiver.get(n) ?? [])),
  ];
  return (
    <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
      <span aria-hidden>→ </span>
      <span className="text-foreground">{receiverNames.join(", ")}</span>
      {channels.length > 0 && <> · {channels.join(", ")}</>}
    </span>
  );
}

// ── Row expansion ─────────────────────────────────────────────────────────────

function InstanceDetail({
  inst,
  onSilence,
  silencePending,
  onCustomSilence,
}: {
  inst: TriageInstance;
  onSilence: (hours: number) => void;
  silencePending: boolean;
  onCustomSilence: () => void;
}) {
  const { alert, rule } = inst;
  // This instance's own stored events, fetched (and polled) only while the
  // row is expanded — the fingerprint narrows server-side, so the board never
  // ships the whole 24h window for one row's detail.
  const ownEvents = useQuery(
    ccQueries.eventHistory(TRIAGE_EVENT_RANGE, {
      fingerprint: alert.key,
      limit: TRIAGE_INSTANCE_EVENT_LIMIT,
    }),
  );
  const own = ownEvents.data ?? [];
  const latest = own.find(
    (e) => e.evidence && Object.keys(e.evidence).length > 0,
  );
  const transitions = own
    .filter((e) => ccEventStatus(e.eventType) !== null)
    .slice(0, 6);
  const runbook = ccRunbookParams(rule);
  const description = rule ? fromCcRule(rule).displayDescription : null;

  return (
    <div className="space-y-3 border-t border-border/60 bg-muted/10 px-3 py-3 pl-9">
      {description && (
        <p className="max-w-prose text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {latest?.evidence && (
        <div className="space-y-1">
          <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
            Evidence
          </div>
          <EvidenceChips
            evidence={latest.evidence}
            truncated={latest.evidenceTruncated}
          />
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Route
        </div>
        {inst.matchedRoutes.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            no route matches — delivery falls through to the firehose
          </span>
        ) : (
          <div className="space-y-1">
            {inst.matchedRoutes.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-foreground">
                  {r.receiver}
                </span>
                <Conditions matchers={r.matchers} emptyLabel="* (catch-all)" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Recent transitions
        </div>
        {ownEvents.isPending ? (
          <Skeleton className="h-4 w-44" />
        ) : transitions.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            no stored transitions in the last 24h
          </span>
        ) : (
          <ul className="space-y-0.5">
            {transitions.map((e) => (
              <li
                key={`${e.timestamp}-${e.eventType}`}
                className="flex items-center gap-2 text-xs tabular-nums"
              >
                <CcStatusDot
                  tone={
                    ccEventStatus(e.eventType) === "firing"
                      ? "firing"
                      : "resolved"
                  }
                />
                <span className="w-14 text-muted-foreground">
                  {ccEventStatus(e.eventType) ?? e.eventType}
                </span>
                <RelativeTime
                  timestamp={e.timestamp}
                  className="text-muted-foreground/80"
                  title={ccFormatTs(e.timestamp)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          last seen{" "}
          {alert.last_seen ? <RelativeTime timestamp={alert.last_seen} /> : "—"}
        </span>
        {alert.absent_count > 0 && <span>absent x{alert.absent_count}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="pr-1 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Silence
        </span>
        {[1, 8, 24].map((h) => (
          <Button
            key={h}
            variant="outline"
            size="sm"
            disabled={silencePending}
            onClick={() => onSilence(h)}
          >
            {h}h
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={silencePending}
          onClick={onCustomSilence}
        >
          Custom
        </Button>
        {runbook && (
          <Link
            to="/runbooks/$project/$slug"
            params={runbook}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            <BookOpenText data-icon="inline-start" />
            Runbook
          </Link>
        )}
        {/* The diagnose edge: from "I'm paged" into the telemetry that fired,
            scoped to the instance's window (and service, when it has one). */}
        <Link
          to="/logs"
          search={ccInstanceLogsSearch(alert)}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          <FileSearch data-icon="inline-start" />
          View logs
        </Link>
      </div>
    </div>
  );
}

function InstanceRow({
  inst,
  expanded,
  onToggle,
  deliveryFact,
  valueLabel,
  children,
}: {
  inst: TriageInstance;
  expanded: boolean;
  onToggle: () => void;
  deliveryFact: React.ReactNode;
  /** The group's value-column name, printed inline on small screens where the
   *  desktop column header row is hidden. */
  valueLabel: string;
  children?: React.ReactNode;
}) {
  const { alert, silence } = inst;
  const muted = alert.status !== "firing";
  // SLO-sourced rows surface the burn-rate tier as a first-class badge (toned
  // by the severity the tier fires at) instead of leaving it buried in the
  // label pills.
  const tier = inst.slo !== undefined ? alert.labels.slo_tier : undefined;
  const shownLabels =
    tier === undefined
      ? alert.labels
      : Object.fromEntries(
          Object.entries(alert.labels).filter(([k]) => k !== "slo_tier"),
        );
  return (
    <div className={cn(muted && "opacity-60")}>
      {/* Mouse convenience on the row; the chevron button is the keyboard and
          screen-reader target (same split as DataTable's onRowClick idiom). */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the chevron button is the keyboard target */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse convenience only */}
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button") !== null) return;
          onToggle();
        }}
        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 transition-colors duration-150 hover:bg-muted/40 md:flex-nowrap"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse instance" : "Expand instance"}
          onClick={onToggle}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </button>
        {/* Fixed width only where columns exist (md+); on the stacked phone
            layout the width would just indent the row. */}
        <span className="shrink-0 text-xs md:w-16">
          <CcInstanceStatusBadge status={alert.status} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {tier !== undefined && inst.slo !== undefined && (
            <CcSloTierBadge
              tier={tier}
              severity={ccSloInstanceSeverity(alert)}
            />
          )}
          {/* A scalar SLO instance's only label is the tier, already shown as
              the badge — don't append a "no labels" placeholder after it. */}
          {(tier === undefined || Object.keys(shownLabels).length > 0) && (
            <LabelSet labels={shownLabels} emptyLabel="no labels" />
          )}
        </span>
        {/* Below md the fixed-width facts wrap onto their own line (phone
            widths can't fit labels + value + time + delivery side by side);
            this breaker forces the wrap, and the pl-8 lines the second row up
            under the status column. */}
        <span className="basis-full md:hidden" aria-hidden />
        <span className="shrink-0 pl-8 font-mono text-xs tabular-nums md:w-16 md:pl-0 md:text-right">
          <span className="font-sans text-muted-foreground md:hidden">
            {valueLabel}{" "}
          </span>
          {/* SLO rows carry the tier's burn rate as their value: print it at
              the engine's own precision (one decimal, ×) instead of the raw
              float. */}
          {inst.slo !== undefined && typeof alert.value === "number"
            ? ccFmtBurn(alert.value)
            : (alert.value ?? "—")}
        </span>
        <span
          className="shrink-0 text-xs whitespace-nowrap text-muted-foreground md:w-24 md:text-right"
          title={ccFormatTs(alert.active_since)}
        >
          {alert.active_since ? (
            <RelativeTime timestamp={alert.active_since} />
          ) : (
            "—"
          )}
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden md:w-56 md:flex-none">
          {silence && (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={[silence.comment, `until ${ccFormatTs(silence.ends_at)}`]
                .filter(Boolean)
                .join(" · ")}
            >
              <BellOff className="size-3" />
              silenced
            </span>
          )}
          {deliveryFact}
        </span>
      </div>
      {expanded && children}
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────

export function TriageBoard({
  groups,
  pending,
  channelsByReceiver,
  hasSubscribers,
  watchingRules,
  lastEventTs,
  eventsUnavailable,
  onCustomSilence,
}: {
  groups: TriageGroup[];
  pending: boolean;
  channelsByReceiver: Map<string, string[]>;
  hasSubscribers: boolean;
  /** For the all-clear readout: how many rules are unpaused. */
  watchingRules: number;
  /** For the all-clear readout: timestamp of the newest stored event. */
  lastEventTs: string | null;
  /**
   * Whether the event read failed. A failed read is not "no events": on an
   * all-clear card that distinction is the whole point, since silence from a
   * broken pipeline looks exactly like silence from a healthy one.
   */
  eventsUnavailable: boolean;
  /**
   * Opens the create drawer seeded with these matchers. Stays a prop because
   * the drawer is shared with the silences panel outside this board.
   */
  onCustomSilence: (matchers: CcMatcher[]) => void;
}) {
  // One row open at a time, and nothing outside the board cares which.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const qc = useQueryClient();
  // The quick-silence buttons live in this board's rows and nowhere else, so
  // the mutation lives here too, as SilencesPanel and the builders do.
  const silenceInstance = useMutation({
    mutationFn: ({ alert, hours }: { alert: CcAlert; hours: number }) =>
      createCcSilence({
        data: {
          matchers: ccSourceScopedSilenceMatchers(alert),
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
          comment: `silenced from triage (${hours}h)`,
        },
      }),
    onSuccess: (_, { hours }) => {
      qc.invalidateQueries({ queryKey: ccQueries.silences().queryKey });
      toast.success(`Silenced for ${hours}h`);
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    // role/label: the board is a landmark distinct from the silences panel
    // below, for assistive tech and scoped queries alike.
    <Card inset="flush-content" role="region" aria-label="Alert instances">
      <CardContent>
        {pending ? (
          <CcTableSkeleton rows={6} />
        ) : groups.length === 0 ? (
          // Nothing to triage at all: the same all-clear instrument the
          // Firing lens used to show, now the board's only empty state.
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <CcStatusDot tone="healthy" />
              All clear
            </span>
            <p className="text-xs text-muted-foreground tabular-nums">
              {watchingRules} {watchingRules === 1 ? "rule" : "rules"} watching
              {eventsUnavailable ? (
                " · event history unavailable"
              ) : lastEventTs ? (
                <>
                  {" · last event "}
                  <RelativeTime timestamp={lastEventTs} />
                </>
              ) : (
                " · no events in the last 24h"
              )}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Firing instances appear here the moment a rule&rsquo;s query
              returns rows.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {groups.map((group) => (
              <section key={group.sourceId} className="py-1">
                <div className="flex items-center gap-2.5 px-3 py-1.5">
                  {group.sloId !== undefined ? (
                    group.slo ? (
                      <Link
                        to="/alerts/slos/$project/$slug"
                        params={parseResourceName(group.slo.name)}
                        className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {group.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-foreground">
                        {group.name}
                      </span>
                    )
                  ) : group.rule ? (
                    <Link
                      to="/alerts/rules/$project/$slug"
                      params={parseResourceName(group.rule.name)}
                      className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {group.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-foreground">
                      {group.name}
                    </span>
                  )}
                  {group.sloId !== undefined && (
                    // Origin marker: this group is an SLO's burn-rate
                    // alerting, not a rule's.
                    <Pill className="text-muted-foreground">SLO</Pill>
                  )}
                  <CcSeverityBadge severity={group.severity} />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {group.instances.length}{" "}
                    {group.instances.length === 1 ? "instance" : "instances"}
                  </span>
                  {/* One mute for the whole source: opens the drawer seeded
                        with the synthetic scoping matcher (slo/rule), so a
                        30-instance group is one review-and-create away instead
                        of 30 per-row silences. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground"
                    aria-label={`Silence all ${group.name} instances`}
                    onClick={() =>
                      onCustomSilence([
                        group.sloId !== undefined
                          ? { label: "slo", op: "eq", value: group.sloId }
                          : {
                              label: "rule",
                              op: "eq",
                              value: group.sourceId,
                            },
                      ])
                    }
                  >
                    <BellOff data-icon="inline-start" />
                    Silence all
                  </Button>
                </div>
                <div className="hidden items-center gap-3 px-3 pb-0.5 text-[0.625rem] font-medium tracking-wide text-muted-foreground/70 uppercase md:flex">
                  <span className="size-5 shrink-0" />
                  <span className="w-16 shrink-0" />
                  <span className="min-w-0 flex-1" />
                  <span className="w-16 shrink-0 text-right">
                    {group.sloId !== undefined
                      ? "burn rate"
                      : group.rule?.spec.value_column || "value"}
                  </span>
                  <span className="w-24 shrink-0" />
                  <span className="w-56 shrink-0" />
                </div>
                {group.instances.map((inst) => (
                  <InstanceRow
                    key={inst.alert.key}
                    inst={inst}
                    valueLabel={
                      group.sloId !== undefined
                        ? "burn rate"
                        : group.rule?.spec.value_column || "value"
                    }
                    expanded={expandedKey === inst.alert.key}
                    onToggle={() =>
                      setExpandedKey((k) =>
                        k === inst.alert.key ? null : inst.alert.key,
                      )
                    }
                    deliveryFact={
                      <DeliveryFact
                        matchedRoutes={inst.matchedRoutes}
                        channelsByReceiver={channelsByReceiver}
                        hasSubscribers={hasSubscribers}
                      />
                    }
                  >
                    <InstanceDetail
                      inst={inst}
                      silencePending={silenceInstance.isPending}
                      onSilence={(hours) =>
                        silenceInstance.mutate({ alert: inst.alert, hours })
                      }
                      onCustomSilence={() =>
                        // The create drawer lives on the page — a custom
                        // silence opens pre-seeded in place, no navigation.
                        onCustomSilence(
                          ccSourceScopedSilenceMatchers(inst.alert),
                        )
                      }
                    />
                  </InstanceRow>
                ))}
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
