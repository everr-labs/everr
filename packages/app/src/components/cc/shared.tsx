// packages/app/src/components/cc/shared.tsx
import { Badge } from "@everr/ui/components/badge";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { sortedLabelEntries } from "@/data/alerts/matchers";
import type { CcMatcher, CcRuleView } from "@/data/cc/types";
import { ccOpSymbol } from "./route-resolution";

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
// than importing the server-only CcApiError class into this client-bundled module.
// The message already carries CC's problem+json `detail`.
export function ccErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/fetch failed|timeout|ECONNREFUSED/i.test(error.message)) {
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
  | "live"
  | "disconnected"
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
  live: "bg-primary",
  healthy: "bg-emerald-500",
  inactive: "bg-muted-foreground/50",
  disconnected: "bg-muted-foreground/50",
  resolved: "bg-muted-foreground/50",
};

const TONE_TEXT: Record<Tone, string> = {
  firing: "text-destructive",
  // Matches the amber degraded dot above — degraded is a health warning, not
  // the firing red.
  degraded: "text-amber-600 dark:text-amber-400",
  pending: "text-foreground",
  live: "text-foreground",
  healthy: "text-muted-foreground",
  inactive: "text-muted-foreground",
  disconnected: "text-muted-foreground",
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

export function CcConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <CcStatusLabel tone={connected ? "live" : "disconnected"} pulse={connected}>
      {connected ? "live" : "disconnected"}
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

// Rule health rides on the same dot-plus-tooltip idiom the alerts home uses
// (a CcStatusDot wrapped in a `title`d span): the dot carries the state, the
// title carries the facts, joined with the home's " · " separator.
function ccRuleHealthTitle(rule: CcRuleView): string {
  const checksEvery = `checks every ${rule.spec.interval_secs}s`;
  if (rule.health.status !== "degraded") {
    return `Healthy · ${checksEvery}`;
  }
  const parts = ["Degraded"];
  if (rule.health.degraded_since) {
    parts.push(`since ${ccFormatTs(rule.health.degraded_since)}`);
  }
  if (rule.health.last_error) {
    parts.push(`last error: ${rule.health.last_error}`);
  }
  parts.push(checksEvery);
  return parts.join(" · ");
}

export function CcRuleHealthDot({ rule }: { rule: CcRuleView }) {
  return (
    <span title={ccRuleHealthTitle(rule)} className="inline-flex items-center">
      <CcStatusDot
        tone={rule.health.status === "degraded" ? "degraded" : "healthy"}
      />
    </span>
  );
}

// ── Conditions & labels ───────────────────────────────────────────────────────
// Rendered as scannable pills instead of a comma-run-on mono string.

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none">
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
        // biome-ignore lint/suspicious/noArrayIndexKey: matchers are positional, no stable id
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
    ? sortedLabelEntries(
        Object.fromEntries(
          Object.entries(evidence).map(([key, value]) => [
            key,
            formatEvidenceValue(value),
          ]),
        ),
      )
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

// ── Empty & loading ───────────────────────────────────────────────────────────

export function CcEmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {Icon && (
        <Icon className="size-6 text-muted-foreground/60" strokeWidth={1.5} />
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function CcTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholder
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
