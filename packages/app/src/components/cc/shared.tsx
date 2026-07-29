// packages/app/src/components/cc/shared.tsx
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
import { CollapsibleTrigger } from "@everr/ui/components/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import {
  type Tone as HealthTone,
  toneDot,
  toneText,
} from "@everr/ui/components/tone";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Heart,
  HeartCrack,
  Info,
  type LucideIcon,
  Pause,
  Play,
  RotateCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { ccErrorInfo } from "@/data/cc/errors";
import { ccOpSymbol } from "@/data/cc/route-resolution";
import type { CcMatcher, CcRuleHealthStatus } from "@/data/cc/types";

// ── Guidance ──────────────────────────────────────────────────────────────────
// Plain-language, always-visible explainers. Alerting is hard; the UI should
// teach the concept in place rather than expose a raw control and hope.

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

// CC failures arrive as CcApiError, whose status/code survive the server-fn
// serialization boundary structurally (see ccErrorInfo in data/cc/errors.ts):
// status 0 marks a transport-level failure (CC unreachable / timed out), any
// other status carries CC's problem+json detail as the message. The regex is
// only a last-resort fallback for failures that never reached the CC client —
// e.g. the browser's own request to the server fn failing.
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
        // Refetching errored queries under the "cc" prefix re-runs exactly the
        // queries whose failure produced this card; a transient outage clears
        // without a full page reload.
        onClick={() => qc.refetchQueries({ queryKey: ["cc"] })}
      >
        <RotateCw data-icon="inline-start" />
        Retry
      </Button>
    </div>
  );
}

// ── Status readout ──────────────────────────────────────────────────────────
// The instrument-panel vocabulary: a colored dot + a word. Status never rides on
// color alone (the dot is paired with a label), so it survives colorblind viewing.

type Tone =
  | "firing"
  | "pending"
  | "inactive"
  | "degraded"
  | "healthy"
  | "resolved"
  | "warning";

// Each status tone maps onto one health tone; the colour itself lives in
// ./tone.ts. `degraded` is rule-health rather than alert state, so it shares
// warning's amber: "needs attention", never confused with a firing alert.
const TONE_KIND: Record<Tone, HealthTone> = {
  firing: "danger",
  degraded: "warning",
  warning: "warning",
  pending: "live",
  healthy: "healthy",
  inactive: "muted",
  resolved: "muted",
};

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
            toneDot({ tone: TONE_KIND[tone] }),
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex size-1.5 rounded-full",
          toneDot({ tone: TONE_KIND[tone] }),
        )}
      />
    </span>
  );
}

function CcStatusLabel({
  tone,
  pulse,
  children,
}: {
  tone: Tone;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        // Healthy status text stays quiet: the dot already carries the state,
        // and a green word on every calm row would shout as loudly as a red one.
        toneText({
          tone: TONE_KIND[tone] === "healthy" ? "muted" : TONE_KIND[tone],
        }),
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
      ? "firing"
      : severity === "warning"
        ? "warning"
        : "inactive";
  return <CcStatusLabel tone={tone}>{severity}</CcStatusLabel>;
}

export function CcEventStatusBadge({ status }: { status: string }) {
  const firing = status === "firing";
  return (
    <CcStatusLabel tone={firing ? "firing" : "resolved"} pulse={firing}>
      {status}
    </CcStatusLabel>
  );
}

export function CcInstanceStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "firing"
      ? "firing"
      : status === "pending"
        ? "pending"
        : "inactive";
  return (
    <CcStatusLabel tone={tone} pulse={tone === "firing"}>
      {status}
    </CcStatusLabel>
  );
}

/**
 * A burn-rate tier as a badge: the tier's name (real engine vocabulary —
 * "fast-burn", "slow-burn", "ticket", or the SLO's own tier names), toned by
 * the severity the tier fires at.
 */
export function CcSloTierBadge({
  tier,
  severity,
}: {
  tier: string;
  severity: string;
}) {
  const tone: Tone =
    severity === "critical"
      ? "firing"
      : severity === "warning"
        ? "warning"
        : "inactive";
  return (
    <CcStatusLabel tone={tone}>
      <span className="font-mono text-[0.6875rem]">{tier}</span>
    </CcStatusLabel>
  );
}

// ── Conditions & labels ───────────────────────────────────────────────────────
// Rendered as scannable pills instead of a comma-run-on mono string.

export function Pill({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Conditions({
  matchers,
  emptyLabel = "*",
}: {
  matchers: CcMatcher[];
  emptyLabel?: string;
}) {
  if (matchers.length === 0) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {emptyLabel}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {matchers.map((m, i) => (
        <Pill key={i}>
          <span className="text-foreground">{m.label}</span>
          <span className="text-muted-foreground">{ccOpSymbol(m.op)}</span>
          <span className="text-foreground">{m.value}</span>
        </Pill>
      ))}
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

// CC evidence (source-row columns beyond the identity labels) rendered as
// compact key=value pills, mirroring the silence matcher chips so the
// timeline stays visually consistent with LabelSet above it.
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
// The one CollapsibleTrigger style for the alerts surfaces: chevron that
// rotates open, dotted focus outline, quiet hover. Two shapes:
//   boxed (default) — a full-width bordered bar (bg-muted/20; pass e.g.
//     `bg-card` via className where the bar sits on a muted background);
//   bare — an inline text trigger (pass `w-full text-left` or
//     `text-muted-foreground` via className where a site needs them).
// Children carry the label and any trailing summary content.

export function CcDisclosureTrigger({
  open,
  variant = "boxed",
  className,
  children,
}: {
  /** The Collapsible's open state; drives the chevron rotation. */
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

// ── Segmented control ─────────────────────────────────────────────────────────
// The coarse lens switcher (triage lenses, event-kind lenses): a single-select
// ToggleGroup styled as one bordered pill row, the active segment lifted onto
// the card surface.

export function CcSegmentedControl<K extends string>({
  items,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  items: readonly { key: K; label: ReactNode }[];
  value: K;
  onChange: (key: K) => void;
  "aria-label": string;
}) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      // spacing=1 opts out of the joined data-[spacing=0] look (each segment
      // keeps its own radius); the group's gap is zeroed back out below.
      spacing={1}
      className="inline-flex gap-0 rounded-md border border-border bg-muted/20 p-0.5"
      onValueChange={(next) => {
        // Single-select ToggleGroup allows deselect-to-empty; ignore it so one
        // option is always selected.
        const key = next[0];
        if (key !== undefined) onChange(key as K);
      }}
    >
      {items.map((item) => (
        <ToggleGroupItem
          key={item.key}
          value={item.key}
          className="h-auto min-w-0 rounded-[0.3rem] px-3 py-1 text-xs font-medium text-muted-foreground outline-offset-[-2px] transition-colors hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-primary aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-foreground/10"
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ── Empty & loading ───────────────────────────────────────────────────────────

export function CcEmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon?: LucideIcon;
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

/** Compact RFC-3339 → local string; null-safe. */
export function ccFormatTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

// ── Evaluation health ─────────────────────────────────────────────────────────

const HEART = {
  healthy: {
    Icon: Heart,
    tone: "healthy",
    label: "Evaluating",
    detail: "The query is evaluating on schedule.",
  },
  degraded: {
    Icon: HeartCrack,
    tone: "danger",
    label: "Evaluation degraded",
    detail:
      "The query is failing, so this is not being evaluated. Nothing new can fire and the numbers stop moving until it runs again.",
  },
} as const satisfies Record<
  CcRuleHealthStatus,
  { Icon: LucideIcon; tone: HealthTone; label: string; detail: string }
>;

/**
 * Evaluation health as a single glyph: a whole heart while the query runs, a
 * broken one when it does not. Deliberately the smallest possible readout —
 * a listing cannot act on the forensics, so it carries the fact and the
 * tooltip carries the consequence.
 *
 * Renders nothing without a status: an SLO with no snapshot yet has no health
 * to report, and a placeholder would read as a verdict.
 */
export function CcHealthHeart({
  status,
  className,
}: {
  status: CcRuleHealthStatus | undefined;
  className?: string;
}) {
  if (!status) return null;
  const { Icon, tone, label, detail } = HEART[status];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // A button, not a bare span: the tooltip has to be reachable by
          // keyboard, and this is the only explanation of the glyph there is.
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex shrink-0 items-center rounded-sm outline-2 outline-dotted outline-transparent outline-offset-2 focus-visible:outline-primary",
              toneText({ tone }),
              className,
            )}
          />
        }
      >
        <Icon className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{detail}</TooltipContent>
    </Tooltip>
  );
}

// ── Pause / resume ────────────────────────────────────────────────────────────

/** What a pause silences, in the words the confirmation uses. */
type CcPausableKind = "SLO" | "alert rule";

const PAUSE_CONSEQUENCE: Record<CcPausableKind, string> = {
  SLO: "It stops being evaluated, so its error budget stops updating and none of its burn-rate alerts can fire. Breaches during the pause pass unnoticed and unrecorded.",
  "alert rule":
    "It stops being evaluated, so it cannot fire or resolve while paused. Anything it would have caught passes unnoticed.",
};

/**
 * Pause or resume an evaluated resource, confirming before the pause.
 *
 * Only the pause asks. Pausing takes a detector offline and the cost of it is
 * silent by construction: nothing fires, so nothing tells you later that you
 * paused it. Resuming restores the normal state and shows its own effect, so a
 * dialog there would be a click to dismiss rather than a decision to make.
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
  /** The resource's display name, for the confirmation's title. */
  name: string;
  /** "ghost" in a table row, "outline" beside a page heading. */
  variant?: "ghost" | "outline";
  onToggle: () => void;
}) {
  // Table rows use the small ghost button; a page heading uses the default
  // size, matching the controls beside it.
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
