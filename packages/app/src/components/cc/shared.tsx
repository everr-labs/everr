// packages/app/src/components/cc/shared.tsx
import { Badge } from "@everr/ui/components/badge";
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
import { cn } from "@everr/ui/lib/utils";
import { ChevronRight, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
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

// CC server-fn errors (incl. CcApiError) are serialized across the server→client
// boundary and arrive as plain Errors, so we match on `error.message` here rather
// than importing the class into this client-bundled module. The transport wraps
// network/timeout failures with the stable "clickety-clack unreachable"/"request
// timed out" prefixes matched below; the message already carries CC's
// problem+json `detail`.
export function ccErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (
      /clickety-clack unreachable|clickety-clack request timed out|fetch failed|timeout|ECONNREFUSED/i.test(
        error.message,
      )
    ) {
      return "Alerting service unavailable";
    }
    return error.message;
  }
  return "Unknown error";
}

export function CcQueryError({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
    >
      {ccErrorMessage(error)}
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
  | "resolved";

const TONE_DOT: Record<Tone, string> = {
  firing: "bg-destructive",
  // Rule health (evaluation success), distinct from alert/instance state
  // above: green/amber rather than the firing red, so a degraded rule reads
  // as "needs attention" without being confused with an actual firing alert.
  degraded: "bg-amber-500",
  pending: "bg-primary",
  healthy: "bg-emerald-500",
  inactive: "bg-muted-foreground/50",
  resolved: "bg-muted-foreground/50",
};

const TONE_TEXT: Record<Tone, string> = {
  firing: "text-destructive",
  // Matches the amber degraded dot above — degraded is a health warning, not
  // the firing red.
  degraded: "text-amber-600 dark:text-amber-400",
  pending: "text-foreground",
  healthy: "text-muted-foreground",
  inactive: "text-muted-foreground",
  resolved: "text-muted-foreground",
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
            TONE_DOT[tone],
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex size-1.5 rounded-full",
          TONE_DOT[tone],
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
        TONE_TEXT[tone],
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
        ? "pending"
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

export function CcHealthBadge({ status }: { status: CcRuleHealthStatus }) {
  const degraded = status === "degraded";
  return (
    <CcStatusLabel tone={degraded ? "degraded" : "healthy"} pulse={degraded}>
      {status}
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
