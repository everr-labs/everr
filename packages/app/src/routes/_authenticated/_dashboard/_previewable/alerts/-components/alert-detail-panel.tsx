import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { ArrowUpRight, NotebookText, X } from "lucide-react";
import { formatElapsed } from "@/data/alerting/triage/format";
import type {
  AlertDetail,
  RuleInventoryState,
} from "@/data/alerting/triage/view";
import { AlertInstanceChart } from "./alert-instance-chart";
import { STATUS_META, StatusIcon } from "./alert-status";
import { Section } from "./detail-section";
import { SilenceHistory } from "./silence-history";

/** One label/value line of the definition table. The label column is sized in
 *  `ch` off the longest label rather than in `rem`: the panel is a column, not
 *  a page, and a fixed 10rem gutter spent the value's width on air. */
function DefinitionRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-baseline gap-3 border-b py-2.5 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * The condition, marked as the threshold it is. The glyph is the chart's own
 * dashed guide line rather than a stock icon: `value >= 2` beside a heading
 * reads as a measurement, and the reader has to work out that it is the bar
 * the values are held against. Drawing the line the plot draws says it.
 */
function ThresholdLabel({ condition }: { condition: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground" />
        }
      >
        <svg
          aria-hidden="true"
          width="14"
          height="6"
          viewBox="0 0 14 6"
          className="shrink-0"
        >
          <line
            x1="0"
            y1="3"
            x2="14"
            y2="3"
            stroke="var(--chart-2)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        </svg>
        {condition}
      </TooltipTrigger>
      <TooltipContent>
        Threshold, drawn on the chart as this line
      </TooltipContent>
    </Tooltip>
  );
}

/** "Silenced just now", "Firing for 12m". The duration is the whole reason
 *  the state matters, so it belongs in the same phrase, not in a chip beside
 *  it. */
function statePhrase(state: RuleInventoryState, since: string | null) {
  const label = STATUS_META[state].label;
  if (!since) return label;
  return since === "just now" ? `${label} just now` : `${label} for ${since}`;
}

/** What the state means for delivery. `notification` already answers it for
 *  every state; silenced and paused both stop notifications, and only the
 *  second one also stops evaluating, which is the difference readers ask
 *  about. */
function consequence(state: RuleInventoryState, notification: string) {
  if (state === "silenced") {
    // The delivery line names the silence too, and the phrase beside it has
    // already said so; two "silenced" in one sentence read as two facts.
    const delivery = notification.replace(/^silenced · /, "");
    return `${delivery} · rule keeps evaluating`;
  }
  if (state === "paused") return "nothing will be sent · rule is not evaluated";
  return notification;
}

/** The panel is mounted the moment a rule is picked, so the column has to
 *  stand up before the detail query answers. Sized like the real thing: the
 *  chart lane, the timeline, the definition table. */
function DetailSkeleton() {
  return (
    <div className="space-y-5 p-3">
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <Skeleton className="h-24 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  );
}

/**
 * Alert detail, as the third column of the triage workspace rather than an
 * overlay: triage is a list you work through, comparing one rule against the
 * next, and a drawer covered the list you were comparing against. The panel
 * takes width from the list instead of hiding it, which is the same trade the
 * log inspector makes on Explore.
 *
 * It stays addressable (`/alerts?alert=<project>/<slug>`), so it survives a
 * reload and can be pasted into an incident channel.
 */
export function AlertDetailPanel({
  path,
  detail,
  onClose,
  onCancelSilence,
  onSilence,
  silencePending,
  onTogglePaused,
  pausePending,
}: {
  /** Known before the detail loads, and the only identity the header can show
   *  while the query is in flight. */
  path: string;
  /** `null` while the detail for `path` is still loading. */
  detail: AlertDetail | null;
  onClose: () => void;
  /** Close a silence's window early, by id. Taking the id rather than "the
   *  silence" is the point: the panel can reach a scheduled silence and the
   *  second of two overlapping ones, neither of which the header's single
   *  button could name. */
  onCancelSilence: (id: string) => void;
  /** Open the silence dialog for this rule, optionally seeded from a silence
   *  that has already closed: the same noise coming back is the commonest
   *  reason anyone reads this section, and retyping the matchers is the
   *  commonest reason the new silence is scoped wrong. */
  onSilence: (seed?: { matchers: string; comment: string }) => void;
  /** A silence write is in flight; every silence control goes inert. */
  silencePending: boolean;
  /** Pause stops evaluation entirely; silence only stops delivery. Both live
   *  here rather than on the row: they change the rule, not the reader's view
   *  of it, so they belong where the rule is on screen in full. */
  onTogglePaused: (paused: boolean) => void;
  pausePending: boolean;
}) {
  const state: RuleInventoryState | null = detail
    ? detail.paused
      ? "paused"
      : detail.status
    : null;
  // A silenced rule is still firing, so `detail.since` dates the fire, not the
  // silence. The phrase says "Silenced", so it has to count from the silence.
  //
  // Which silence is not "the newest active one": a whole-rule silence
  // outranks an instance-scoped one, and the server already made that call
  // when it decided the rule was silenced at all. Reading its verdict back is
  // what keeps this duration and the button beside it talking about the same
  // row.
  const activeSilence = detail?.silences.find(
    (s) => s.id === detail.activeSilenceId,
  );
  const since =
    state === "silenced" && activeSilence
      ? formatElapsed(Date.now() - new Date(activeSilence.startsAt).getTime())
      : (detail?.since ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/10">
      <div className="flex flex-col gap-2 border-b bg-background px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="truncate font-mono text-xs text-muted-foreground">
              {path}
            </p>
            {detail ? (
              <h2 className="text-base font-semibold text-pretty">
                {detail.name}
              </h2>
            ) : (
              <Skeleton className="my-1 h-4 w-48" />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close alert details"
            className="-mt-1 -mr-1 shrink-0"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        {/* State and its delivery consequence read as one sentence: "what is
            it doing" is never asked without "and did anyone hear about it",
            so they share a line.
            
            No control on the end of it. Lifting a silence used to live here,
            back when the header was the only place that could reach one; the
            Silences section now carries Cancel on the row it belongs to, and
            a second button naming no particular silence was the vaguer of the
            two. */}
        {detail && state && (
          <p className="flex min-w-0 items-baseline gap-2 text-xs">
            <StatusIcon status={state} className="size-3 self-center" />
            <span className="font-medium whitespace-nowrap">
              {statePhrase(state, since)}
            </span>
            <span className="min-w-0 truncate font-mono text-muted-foreground">
              {consequence(state, detail.notification)}
            </span>
          </p>
        )}

        {/* The warning belongs beside the state line: everything below the
            header is the frozen data it warns about. */}
        {detail?.paused && (
          <p className="rounded-md border border-chart-2/40 bg-chart-2/8 px-3 py-2 text-xs text-chart-2">
            Instances and state below are frozen at the moment this rule stopped
            evaluating.
          </p>
        )}
      </div>

      {!detail ? (
        <DetailSkeleton />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <div className="space-y-3 px-3 py-3.5">
            <p className="max-w-prose text-xs text-muted-foreground text-pretty">
              {detail.description}
            </p>
            {/* The rule's three numbers stay one mono line rather than three
                badges: they are read together, and a badge each turns a
                single fact into three objects to scan. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="font-mono text-xs text-muted-foreground">
                severity {detail.severity} · every{" "}
                {detail.definition.evaluationInterval} · for {detail.forClause}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pausePending}
                  onClick={() => onTogglePaused(!detail.paused)}
                >
                  {detail.paused ? "Resume" : "Pause"}
                </Button>
                {/* Only rules that declare `link.runbook` get the button: an
                    action that goes nowhere is worse than a missing one. */}
                {detail.definition.runbook && (
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={
                      <a
                        href={detail.definition.runbook.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Runbook
                        <ArrowUpRight data-icon="inline-end" />
                      </a>
                    }
                  />
                )}
              </div>
            </div>
          </div>

          <Section
            title={`Instances · ${detail.instanceSummary}`}
            aside={<ThresholdLabel condition={detail.condition} />}
            flush
          >
            {detail.instanceValues.length === 0 ? (
              <p className="px-3 text-xs text-muted-foreground">
                The rule evaluated no rows in this window.
              </p>
            ) : (
              <AlertInstanceChart
                lanes={detail.instanceValues}
                hidden={detail.hiddenInstanceValues}
                threshold={detail.threshold}
                bucketMinutes={detail.bucketMinutes}
                intervalMinutes={detail.intervalMinutes}
              />
            )}
          </Section>

          <Section title="History">
            {detail.timeline.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No lifecycle events recorded. This rule has not opened an
                instance in the retained history.
              </p>
            )}
            <ol className="flex flex-col">
              {detail.timeline.map((event, i) => (
                <li
                  key={`${event.time}-${i}`}
                  className="flex items-start gap-3"
                >
                  <div className="flex w-2 shrink-0 flex-col items-center pt-1.5">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        event.current ? "bg-destructive" : "bg-muted",
                      )}
                    />
                    {i < detail.timeline.length - 1 && (
                      <span className="min-h-4 w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="flex items-baseline gap-3 pb-2.5">
                    <span className="w-12 font-mono text-xs text-muted-foreground tabular-nums">
                      {event.time}
                    </span>
                    <span className="font-mono text-xs">{event.text}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <SilenceHistory
            // The section's own "show older" disclosure is per rule; keying
            // it means selecting another rule opens that rule's list closed.
            key={detail.path}
            silences={detail.silences}
            activeSilenceId={detail.activeSilenceId}
            pending={silencePending}
            onSilence={onSilence}
            onCancel={onCancelSilence}
          />

          <Section title="Definition">
            <dl className="text-xs">
              <DefinitionRow label="Repository">
                <span className="font-mono">
                  {detail.definition.repository}
                </span>
              </DefinitionRow>
              <DefinitionRow label="Project">
                {detail.definition.project}
              </DefinitionRow>
              {detail.definition.runbook && (
                <DefinitionRow label="Runbook">
                  <a
                    href={detail.definition.runbook.href}
                    className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
                  >
                    <NotebookText aria-hidden className="size-3.5 shrink-0" />
                    {detail.definition.runbook.label}
                  </a>
                </DefinitionRow>
              )}
              <DefinitionRow label="Evaluation interval">
                {detail.definition.evaluationInterval}
              </DefinitionRow>
              {detail.definition.notificationTitle && (
                <DefinitionRow label="Notification title">
                  {detail.definition.notificationTitle}
                </DefinitionRow>
              )}
              {detail.definition.notificationDescription && (
                <DefinitionRow label="Notification description">
                  {detail.definition.notificationDescription}
                </DefinitionRow>
              )}
              <DefinitionRow label="Last evaluated">
                {detail.definition.lastEvaluatedAt
                  ? new Date(detail.definition.lastEvaluatedAt).toLocaleString(
                      undefined,
                      { dateStyle: "medium", timeStyle: "short" },
                    )
                  : "Never"}
              </DefinitionRow>
            </dl>

            <div className="mt-4">
              <p className="mb-2 text-xs text-muted-foreground">Query</p>
              {/* The query is the rule. It gets a real code block rather than
                  a one-line value, because reading it is how anyone decides
                  whether the alert is measuring the right thing. */}
              <pre className="overflow-x-auto rounded-md border bg-background/70 p-3 font-mono text-xs leading-relaxed">
                <code>{detail.definition.query}</code>
              </pre>
            </div>
          </Section>
          <div className="pb-8" />
        </div>
      )}
    </div>
  );
}
