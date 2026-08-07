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
import { CollapsibleTrigger } from "@everr/ui/components/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import { type Tone, toneDot, toneText } from "@everr/ui/components/tone";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChevronRight,
  HeartCrack,
  Info,
  Pause,
  Play,
  RotateCw,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { alertingErrorInfo } from "@/data/alerting/errors";
import { alertingQueries } from "@/data/alerting/queries";
import {
  alertingIsCatchAll,
  alertingOpSymbol,
} from "@/data/alerting/routing/resolution";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingFmtWindowLabel,
  alertingSloIdentity,
} from "@/data/alerting/slos/model";
import type {
  AlertingMatcher,
  AlertingRuleHealthStatus,
  AlertingSloTier,
} from "@/data/alerting/types";
import { usePreview } from "@/hooks/use-preview";
import type { ChannelIcon } from "../delivery/channel-meta";

// ── Guidance ──────────────────────────────────────────────────────────────────

export function AlertingConceptNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-px size-3.5 shrink-0 text-muted-foreground/70" />
      <div className="[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.6875rem] [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  );
}

// AlertingError fields survive server-fn serialization structurally. Status 0
// and transport-shaped messages represent service unavailability.
export function alertingErrorMessage(error: unknown): string {
  const info = alertingErrorInfo(error);
  if (info) {
    return info.status === 0 ? "Alerting service unavailable" : info.message;
  }
  if (error instanceof Error) {
    if (
      /fetch failed|failed to fetch|timeout|ECONNREFUSED/i.test(error.message)
    ) {
      return "Alerting service unavailable";
    }
    return error.message;
  }
  return "Unknown error";
}

export function AlertingQueryError({ error }: { error: unknown }) {
  const qc = useQueryClient();
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <span>{alertingErrorMessage(error)}</span>
      <Button
        variant="outline"
        size="sm"
        // Refetching under the "alerting" prefix re-runs exactly the queries whose
        // failure produced this card.
        onClick={() => qc.refetchQueries({ queryKey: ["alerting"] })}
      >
        <RotateCw data-icon="inline-start" />
        Retry
      </Button>
    </div>
  );
}

// ── Status readout ──────────────────────────────────────────────────────────
// Status never rides on color alone: the dot is always paired with a label.

export function AlertingStatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-1.5 shrink-0", className)}>
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping",
            toneDot({ tone }),
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex size-1.5 rounded-full",
          toneDot({ tone }),
        )}
      />
    </span>
  );
}

export function AlertingStatusLabel({
  tone,
  pulse,
  muted,
  className,
  children,
}: {
  tone: Tone;
  pulse?: boolean;
  muted?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        toneText({ tone: muted ? "muted" : tone }),
        className,
      )}
    >
      <AlertingStatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

export function AlertingSeverityBadge({ severity }: { severity: string }) {
  const tone: Tone =
    severity === "critical"
      ? "danger"
      : severity === "warning"
        ? "warning"
        : severity === "info"
          ? "info"
          : "muted";
  return <AlertingStatusLabel tone={tone}>{severity}</AlertingStatusLabel>;
}

export function AlertingAlertStatusLabel({ status }: { status: string }) {
  const firing = status === "firing";
  const pending = status === "pending";
  const tone: Tone = firing ? "danger" : pending ? "warning" : "muted";
  return (
    <AlertingStatusLabel tone={tone} pulse={firing} muted={pending}>
      {status}
    </AlertingStatusLabel>
  );
}

/** Human labels for stored SLO tier names. */
export function AlertingSloTierBadge({
  tier,
  severity,
  tiers = ALERTING_CANONICAL_SLO_TIERS,
}: {
  tier: string;
  severity: string;
  /**
   * The SLO's resolved tiers. The canonical default only misquotes window
   * sizes for non-30d SLOs; thresholds and severities are the same everywhere.
   */
  tiers?: readonly AlertingSloTier[];
}) {
  const tone: Tone =
    severity === "critical"
      ? "danger"
      : severity === "warning"
        ? "warning"
        : "muted";
  const spec = tiers.find((t) => t.name === tier);
  const consequence =
    severity === "critical"
      ? "Pages whoever the route resolves to."
      : "Opens a ticket rather than paging.";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // A button, not a bare span: the tooltip must be keyboard-reachable.
          <button
            type="button"
            className="rounded-sm outline-2 outline-dotted outline-transparent outline-offset-2 focus-visible:outline-primary"
          />
        }
      >
        <AlertingStatusLabel tone={tone}>
          <span className="font-mono text-[0.6875rem]">{tier}</span>
        </AlertingStatusLabel>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 space-y-1 text-xs">
        {spec ? (
          <p>
            Fires when the last {alertingFmtWindowLabel(spec.long_window)} and
            the last {alertingFmtWindowLabel(spec.short_window)} both burn error
            budget at {spec.burn_rate}&times; or faster.
          </p>
        ) : (
          <p>
            A burn-rate tier this SLO no longer defines, so its thresholds are
            unknown.
          </p>
        )}
        <p className="text-muted-foreground">{consequence}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Conditions & labels ───────────────────────────────────────────────────────

export function Pill({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A matcher value resolved to the first-class name it points at (a `rule` or
 * `slo` label whose value is the resource's id), so the pipeline reads as
 * names, not UUIDs. The raw value stays reachable as the link's title.
 */
type AlertingMatcherValueLink = {
  text: string;
  to: "/alerts/rules/$project/$slug" | "/alerts/slos/$project/$slug";
  params: { project: string; slug: string };
};

// The SLO listing is preview-scoped like the pages themselves, so a matcher
// pointing at a preview-only SLO still resolves while that preview is open.
function useAlertingMatcherValueLink(): (
  m: AlertingMatcher,
) => AlertingMatcherValueLink | null {
  const { name: preview } = usePreview();
  const rules = useQuery(alertingQueries.rules());
  const slos = useQuery(alertingQueries.slos(preview));
  return useMemo(() => {
    const byId = new Map<string, AlertingMatcherValueLink>();
    for (const r of rules.data ?? []) {
      const identity = alertingRuleIdentity(r);
      byId.set(r.id, {
        text: identity.name,
        to: "/alerts/rules/$project/$slug",
        params: { project: identity.project, slug: identity.slug },
      });
    }
    for (const s of slos.data ?? []) {
      const identity = alertingSloIdentity(s);
      byId.set(s.id, {
        text: identity.name,
        to: "/alerts/slos/$project/$slug",
        params: { project: identity.project, slug: identity.slug },
      });
    }
    return (m: AlertingMatcher) =>
      m.label === "rule" || m.label === "slo"
        ? (byId.get(m.value) ?? null)
        : null;
  }, [rules.data, slos.data]);
}

export function Conditions({
  matchers,
  emptyLabel = "*",
}: {
  matchers: AlertingMatcher[];
  emptyLabel?: string;
}) {
  const resolveValue = useAlertingMatcherValueLink();
  if (alertingIsCatchAll(matchers)) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {emptyLabel}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {matchers.map((m, i) => {
        const link = resolveValue(m);
        return (
          <Pill key={i}>
            <span className="text-foreground">{m.label}</span>
            <span className="text-muted-foreground">
              {alertingOpSymbol(m.op)}
            </span>
            {link ? (
              <Link
                to={link.to}
                params={link.params}
                title={m.value}
                className="text-foreground underline-offset-2 hover:underline"
              >
                {link.text}
              </Link>
            ) : (
              <span className="text-foreground">{m.value}</span>
            )}
          </Pill>
        );
      })}
    </span>
  );
}

export function LabelSet({
  labels,
  emptyLabel = "—",
}: {
  labels: Record<string, string>;
  emptyLabel?: string;
}) {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <Pill key={k}>
          <span className="text-muted-foreground">{k}</span>
          <span className="text-muted-foreground/60">=</span>
          <span className="text-foreground">{v}</span>
        </Pill>
      ))}
    </span>
  );
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function EvidenceChips({
  evidence,
  truncated,
}: {
  evidence: Record<string, unknown> | null | undefined;
  truncated?: boolean;
}) {
  const entries = evidence
    ? Object.entries(evidence)
        .map(([key, value]) => [key, formatEvidenceValue(value)] as const)
        .sort(([a], [b]) => a.localeCompare(b))
    : [];
  if (entries.length === 0 && !truncated) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="font-mono font-normal">
          {key}={value}
        </Badge>
      ))}
      {truncated && (
        <span className="text-xs text-muted-foreground">
          evidence truncated
        </span>
      )}
    </div>
  );
}

// ── Disclosure trigger ────────────────────────────────────────────────────────

export function AlertingDisclosureTrigger({
  open,
  variant = "boxed",
  className,
  children,
}: {
  open: boolean;
  variant?: "boxed" | "bare";
  className?: string;
  children: ReactNode;
}) {
  return (
    <CollapsibleTrigger
      className={cn(
        "flex items-center gap-1.5 rounded-md outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 focus-visible:outline-primary",
        variant === "boxed"
          ? "w-full border border-border bg-muted/20 px-3 py-2 text-left hover:bg-muted/40"
          : "px-1 py-0.5 text-xs hover:text-foreground",
        className,
      )}
    >
      <ChevronRight
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
          open && "rotate-90",
        )}
      />
      {children}
    </CollapsibleTrigger>
  );
}

// ── Empty & loading ───────────────────────────────────────────────────────────

export function AlertingEmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon?: ChannelIcon;
  title: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Empty className="border-0 py-12">
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

export function AlertingTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

/**
 * IDs keep selections stable through renames; names must remain unique.
 */
export function isDuplicateName(
  existingNames: string[],
  next: string,
  current?: string,
): boolean {
  return existingNames.includes(next) && next !== current;
}

const ALERTING_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Day-first local timestamp with a deterministic 24-hour clock; null-safe. */
export function alertingFormatTs(
  ts: string | number | Date | null | undefined,
): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? String(ts)
    : ALERTING_DATE_TIME_FORMATTER.format(d);
}

// ── Navigation ────────────────────────────────────────────────────────────────

export function AlertingBackLink({
  to,
  label,
}: {
  to: LinkProps["to"];
  label: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-muted/50 hover:text-foreground"
      aria-label={label}
    >
      <ArrowLeft className="size-4" />
    </Link>
  );
}

export function AlertingRunbookLink({
  project,
  slug,
  name,
}: {
  project: string;
  slug: string;
  name: string;
}) {
  return (
    <Link
      to="/runbooks/$project/$slug"
      params={{ project, slug }}
      aria-label={`Open runbook for ${name}`}
      title="Open runbook"
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:bg-muted/50 hover:text-foreground focus-visible:outline-primary"
    >
      <BookOpenText className="size-3.5" />
    </Link>
  );
}

export function AlertingDefRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground sm:w-28">
        {label}
      </dt>
      {/* min-w-0 so a wide value scrolls inside the row rather than
          stretching the card. */}
      <dd className="min-w-0 flex-1 break-words font-mono text-xs [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

// ── Evaluation health ─────────────────────────────────────────────────────────

/** Renders only while evaluation is degraded; absence is the healthy reading. */
export function AlertingHealthHeart({
  status,
  className,
}: {
  status: AlertingRuleHealthStatus | undefined;
  className?: string;
}) {
  if (status !== "degraded") return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // A button, not a bare span: the tooltip must be keyboard-reachable,
          // and it is the only explanation of the glyph there is.
          <button
            type="button"
            aria-label="Evaluation degraded"
            className={cn(
              "inline-flex shrink-0 items-center rounded-sm outline-2 outline-dotted outline-transparent outline-offset-2 focus-visible:outline-primary",
              toneText({ tone: "danger" }),
              className,
            )}
          />
        }
      >
        <HeartCrack className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        The query is failing, so this is not being evaluated. Nothing new can
        fire and the numbers stop moving until it runs again.
      </TooltipContent>
    </Tooltip>
  );
}

// ── Pause / resume ────────────────────────────────────────────────────────────

type AlertingPausableKind = "SLO" | "alert rule";

const PAUSE_CONSEQUENCE: Record<AlertingPausableKind, string> = {
  SLO: "It stops being evaluated, so its error budget stops updating and none of its burn-rate alerts can fire. Breaches during the pause pass unnoticed and unrecorded.",
  "alert rule":
    "It stops being evaluated, so it cannot fire or resolve while paused. Anything it would have caught passes unnoticed.",
};

/**
 * Only the pause confirms: its cost is silent by construction (nothing fires
 * to remind you later), while a resume shows its own effect.
 */
export function AlertingPauseToggle({
  paused,
  pending,
  kind,
  name,
  variant = "ghost",
  onToggle,
}: {
  paused: boolean;
  pending: boolean;
  kind: AlertingPausableKind;
  name: string;
  /** "ghost" in a table row, "outline" beside a page heading. */
  variant?: "ghost" | "outline";
  onToggle: () => void;
}) {
  const size = variant === "ghost" ? ("sm" as const) : undefined;

  if (paused) {
    return (
      <Button
        variant={variant}
        size={size}
        disabled={pending}
        onClick={onToggle}
      >
        <Play data-icon="inline-start" />
        Resume
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant={variant} size={size} disabled={pending} />}
      >
        <Pause data-icon="inline-start" />
        Pause
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pause {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {PAUSE_CONSEQUENCE[kind]} Resuming picks evaluation back up from the
            live data at that moment; the gap is not backfilled.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onToggle}>
            Pause {kind === "SLO" ? "SLO" : "rule"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Section scaffolding ───────────────────────────────────────────────────────

export function SectionCard({
  title,
  linkLabel,
  to,
  children,
}: {
  title: string;
  linkLabel: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <Card inset="flush-content">
      <CardContent>
        <div className="flex items-center justify-between px-3 pt-1 pb-1.5">
          <h2 className="text-xs font-semibold text-foreground">{title}</h2>
          <Link
            to={to}
            className="-mr-2 inline-flex min-h-11 items-center gap-1 px-2 text-xs text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline md:min-h-8"
          >
            {linkLabel}
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
