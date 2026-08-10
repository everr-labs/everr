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
import { cn } from "@everr/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpenText,
  ChevronRight,
  Info,
  Pause,
  Play,
  RotateCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { alertingErrorInfo } from "@/data/alerting/errors";
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

// ── Pause / resume ────────────────────────────────────────────────────────────

type AlertingPausableKind = "alert rule";

const PAUSE_CONSEQUENCE: Record<AlertingPausableKind, string> = {
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
          <AlertDialogAction onClick={onToggle}>Pause rule</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
