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
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import { ccErrorInfo } from "@/data/cc/errors";
import { ccQueries } from "@/data/cc/queries";
import { ccIsCatchAll, ccOpSymbol } from "@/data/cc/route-resolution";
import {
  CC_CANONICAL_SLO_TIERS,
  ccFmtWindowLabel,
  ccSloIdentity,
} from "@/data/cc/slo";
import type { CcMatcher, CcRuleHealthStatus, CcSloTier } from "@/data/cc/types";
import { usePreview } from "@/hooks/use-preview";
import type { ChannelIcon } from "./channel-meta";

// ── Guidance ──────────────────────────────────────────────────────────────────

export function CcConceptNote({
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

// CcApiError status/code survive the server-fn serialization boundary
// structurally (see ccErrorInfo): status 0 = transport failure, otherwise the
// message carries CC's problem+json detail. The regex is a last-resort
// fallback for failures that never reached the CC client.
export function ccErrorMessage(error: unknown): string {
  const info = ccErrorInfo(error);
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

export function CcQueryError({ error }: { error: unknown }) {
  const qc = useQueryClient();
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <span>{ccErrorMessage(error)}</span>
      <Button
        variant="outline"
        size="sm"
        // Refetching under the "cc" prefix re-runs exactly the queries whose
        // failure produced this card.
        onClick={() => qc.refetchQueries({ queryKey: ["cc"] })}
      >
        <RotateCw data-icon="inline-start" />
        Retry
      </Button>
    </div>
  );
}

// ── Status readout ──────────────────────────────────────────────────────────
// Status never rides on color alone: the dot is always paired with a label.

export function CcStatusDot({
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

export function CcStatusLabel({
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
      <CcStatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

export function CcSeverityBadge({ severity }: { severity: string }) {
  const tone: Tone =
    severity === "critical"
      ? "danger"
      : severity === "warning"
        ? "warning"
        : severity === "info"
          ? "info"
          : "muted";
  return <CcStatusLabel tone={tone}>{severity}</CcStatusLabel>;
}

export function CcAlertStatusLabel({ status }: { status: string }) {
  const firing = status === "firing";
  const pending = status === "pending";
  const tone: Tone = firing ? "danger" : pending ? "warning" : "muted";
  return (
    <CcStatusLabel tone={tone} pulse={firing} muted={pending}>
      {status}
    </CcStatusLabel>
  );
}

/** Tier names ("fast-burn", "slow-burn", "ticket") are the engine's own vocabulary. */
export function CcSloTierBadge({
  tier,
  severity,
  tiers = CC_CANONICAL_SLO_TIERS,
}: {
  tier: string;
  severity: string;
  /**
   * The SLO's resolved tiers. The canonical default only misquotes window
   * sizes for non-30d SLOs; thresholds and severities are the same everywhere.
   */
  tiers?: readonly CcSloTier[];
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
        <CcStatusLabel tone={tone}>
          <span className="font-mono text-[0.6875rem]">{tier}</span>
        </CcStatusLabel>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 space-y-1 text-xs">
        {spec ? (
          <p>
            Fires when the last {ccFmtWindowLabel(spec.long_window)} and the
            last {ccFmtWindowLabel(spec.short_window)} both burn error budget at{" "}
            {spec.burn_rate}&times; or faster.
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
type CcMatcherValueLink = {
  text: string;
  to: "/alerts/rules/$project/$slug" | "/alerts/slos/$project/$slug";
  params: { project: string; slug: string };
};

// The SLO listing is preview-scoped like the pages themselves, so a matcher
// pointing at a preview-only SLO still resolves while that preview is open.
function useCcMatcherValueLink(): (m: CcMatcher) => CcMatcherValueLink | null {
  const { name: preview } = usePreview();
  const rules = useQuery(ccQueries.rules());
  const slos = useQuery(ccQueries.slos(preview));
  return useMemo(() => {
    const byId = new Map<string, CcMatcherValueLink>();
    for (const r of rules.data ?? []) {
      const identity = ccRuleIdentity(r);
      byId.set(r.id, {
        text: identity.name,
        to: "/alerts/rules/$project/$slug",
        params: { project: identity.project, slug: identity.slug },
      });
    }
    for (const s of slos.data ?? []) {
      const identity = ccSloIdentity(s);
      byId.set(s.id, {
        text: identity.name,
        to: "/alerts/slos/$project/$slug",
        params: { project: identity.project, slug: identity.slug },
      });
    }
    return (m: CcMatcher) =>
      m.label === "rule" || m.label === "slo"
        ? (byId.get(m.value) ?? null)
        : null;
  }, [rules.data, slos.data]);
}

export function Conditions({
  matchers,
  emptyLabel = "*",
}: {
  matchers: CcMatcher[];
  emptyLabel?: string;
}) {
  const resolveValue = useCcMatcherValueLink();
  if (ccIsCatchAll(matchers)) {
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
            <span className="text-muted-foreground">{ccOpSymbol(m.op)}</span>
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

export function CcDisclosureTrigger({
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

export function CcEmptyState({
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

export function CcTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

/**
 * Names are editable labels (references are id-based engine-side): a rename
 * may not land on another resource's name, but keeping your own is fine.
 */
export function isDuplicateName(
  existingNames: string[],
  next: string,
  current?: string,
): boolean {
  return existingNames.includes(next) && next !== current;
}

/** Compact RFC-3339 → local string; null-safe. */
export function ccFormatTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

// ── Navigation ────────────────────────────────────────────────────────────────

export function CcBackLink({
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

export function CcRunbookLink({
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

export function CcDefRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-28 shrink-0 text-xs text-muted-foreground">{label}</dt>
      {/* min-w-0 so a wide value scrolls inside the row rather than
          stretching the card. */}
      <dd className="min-w-0 flex-1 font-mono text-xs">{children}</dd>
    </div>
  );
}

// ── Evaluation health ─────────────────────────────────────────────────────────

/** Renders only while evaluation is degraded; absence is the healthy reading. */
export function CcHealthHeart({
  status,
  className,
}: {
  status: CcRuleHealthStatus | undefined;
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

type CcPausableKind = "SLO" | "alert rule";

const PAUSE_CONSEQUENCE: Record<CcPausableKind, string> = {
  SLO: "It stops being evaluated, so its error budget stops updating and none of its burn-rate alerts can fire. Breaches during the pause pass unnoticed and unrecorded.",
  "alert rule":
    "It stops being evaluated, so it cannot fire or resolve while paused. Anything it would have caught passes unnoticed.",
};

/**
 * Only the pause confirms: its cost is silent by construction (nothing fires
 * to remind you later), while a resume shows its own effect.
 */
export function CcPauseToggle({
  paused,
  pending,
  kind,
  name,
  variant = "ghost",
  onToggle,
}: {
  paused: boolean;
  pending: boolean;
  kind: CcPausableKind;
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
            className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
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
