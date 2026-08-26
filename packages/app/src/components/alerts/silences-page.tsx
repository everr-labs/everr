import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { BellOff, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { formatElapsed } from "@/data/alerting/triage/format";
import type { AlertSilencePageRow } from "@/data/alerting/triage/view";

/** Where a silence may be reopened from: the rule it named and the matchers
 *  beyond it, which is what the dialog starts from. */
export type SilenceAgainSeed = {
  rule: string | null;
  seed: { matchers: string; comment: string };
};

const STATE_LABEL: Record<AlertSilencePageRow["state"], string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  cancelled: "Cancelled",
};

// The same marks the detail's silence list uses, so a silence reads the same
// on both screens: filled while muting, hollow while waiting, dim once over.
const STATE_DOT: Record<AlertSilencePageRow["state"], string> = {
  active: "bg-chart-2",
  scheduled: "border border-chart-2 bg-transparent",
  expired: "bg-muted-foreground/40",
  cancelled: "border border-muted-foreground/50 bg-transparent",
};

const COLUMNS =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_7rem_6rem] items-center gap-4";
const COLUMN_LABEL =
  "font-mono text-[0.6875rem] tracking-wider text-muted-foreground uppercase";

const dayLabel = (at: Date) =>
  at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clockLabel = (at: Date) =>
  at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const stamp = (iso: string) => {
  const at = new Date(iso);
  return `${dayLabel(at)}, ${clockLabel(at)}`;
};

const isOpen = (row: AlertSilencePageRow) =>
  row.state === "active" || row.state === "scheduled";

/** "ends in 2h 10m" for a silence that is muting, "starts in 4h" for one that
 *  will; a closed one just says which way it closed. */
function stateText(row: AlertSilencePageRow, now: number): string {
  if (row.state === "active")
    return `ends in ${formatElapsed(new Date(row.endsAt).getTime() - now)}`;
  if (row.state === "scheduled")
    return `starts in ${formatElapsed(new Date(row.startsAt).getTime() - now)}`;
  return STATE_LABEL[row.state];
}

function Row({
  row,
  now,
  pending,
  onCancel,
  onSilenceAgain,
}: {
  row: AlertSilencePageRow;
  now: number;
  pending: boolean;
  onCancel: (id: string) => void;
  onSilenceAgain: (seed: SilenceAgainSeed) => void;
}) {
  const open = isOpen(row);
  return (
    <li
      className={cn(
        COLUMNS,
        "border-t px-3 py-2.5 text-sm transition-colors hover:bg-muted/25",
        !open && "text-muted-foreground",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              STATE_DOT[row.state],
            )}
          />
          {/* The matchers are the silence: there is no name to put above
              them, and the rule is one matcher among the others rather than a
              title the rest narrow. A silence with none prints nothing here;
              absence of text is the statement. */}
          {row.matchers && (
            <span className="truncate font-mono text-xs">{row.matchers}</span>
          )}
        </div>
        {row.comment && (
          <p className="mt-0.5 truncate pl-3.5 text-xs text-muted-foreground">
            {row.comment}
          </p>
        )}
      </div>
      <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
        {/* A cancelled window closes at the stamp that recorded the act. The
            write collapsed `endsAt` to the same instant, give or take the
            transaction, and the two can disagree at the minute this prints. */}
        {stamp(row.startsAt)} → {stamp(row.canceledAt ?? row.endsAt)}
      </span>
      <span className="font-mono text-xs tabular-nums">
        {stateText(row, now)}
      </span>
      {/* Nothing stands in for an impact of nothing: the column is read for
          the few rows where something was withheld, and a dash on every other
          row is what buries them. */}
      <span className="font-mono text-xs text-muted-foreground">
        {row.impact}
      </span>
      <div className="text-right">
        {open ? (
          <Button
            size="sm"
            variant="ghost"
            className="-my-1"
            disabled={pending}
            onClick={() => onCancel(row.id)}
          >
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="-my-1 font-normal text-muted-foreground"
            disabled={pending}
            onClick={() =>
              onSilenceAgain({
                rule: row.rule,
                seed: { matchers: row.scope, comment: row.comment },
              })
            }
          >
            Silence again
          </Button>
        )}
      </div>
    </li>
  );
}

function Section({
  title,
  hint,
  rows,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  rows: AlertSilencePageRow[];
  empty: string;
  children: (row: AlertSilencePageRow) => React.ReactNode;
}) {
  return (
    <section>
      <div className={cn(COLUMNS, "px-3 pb-1.5")}>
        <h2 className="flex items-baseline gap-2 text-sm font-medium">
          {title}
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {rows.length}
          </span>
          {hint && (
            <span className="text-xs font-normal text-muted-foreground">
              {hint}
            </span>
          )}
        </h2>
        <span className={COLUMN_LABEL}>Window</span>
        <span className={COLUMN_LABEL}>State</span>
        <span className={COLUMN_LABEL}>Impact</span>
        <span />
      </div>
      {rows.length === 0 ? (
        <p className="border-t px-3 py-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul>{rows.map(children)}</ul>
      )}
    </section>
  );
}

function SilencesSkeleton() {
  return (
    <div className="space-y-2 pt-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

/**
 * "What is muting right now." Three stacked sections, one dense row per
 * silence: the active section is the control surface, what is coming is a
 * queue, and history is evidence that the picked time range bounds.
 */
export function SilencesPage({
  silences,
  pending,
  onNew,
  onCancel,
  onSilenceAgain,
}: {
  /** `null` while loading. */
  silences: AlertSilencePageRow[] | null;
  /** A silence write is in flight; every silence control goes inert. */
  pending: boolean;
  onNew: () => void;
  onCancel: (id: string) => void;
  onSilenceAgain: (seed: SilenceAgainSeed) => void;
}) {
  // One reading of the clock per render, so two rows cannot disagree about
  // what "in 4m" is measured from.
  const now = Date.now();
  const rows = silences ?? [];
  const active = rows.filter((row) => row.state === "active");
  const scheduled = rows
    .filter((row) => row.state === "scheduled")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const closed = rows.filter((row) => !isOpen(row));

  const row = (record: AlertSilencePageRow) => (
    <Row
      key={record.id}
      row={record}
      now={now}
      pending={pending}
      onCancel={onCancel}
      onSilenceAgain={onSilenceAgain}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Silences"
        icon={BellOff}
        lede={
          silences === null
            ? "Silenced alerts stay visible but are not delivered."
            : `${active.length} active. Silenced alerts stay visible but are not delivered.`
        }
        actions={
          <Button size="sm" onClick={onNew}>
            <Plus className="size-4" />
            New silence
          </Button>
        }
      />
      {silences === null ? (
        <SilencesSkeleton />
      ) : (
        <>
          <Section title="Active" rows={active} empty="Nothing is silenced.">
            {row}
          </Section>
          <Section
            title="Coming up"
            hint="soonest first"
            rows={scheduled}
            empty="No silence is scheduled."
          >
            {row}
          </Section>
          <Section
            title="History"
            hint="in range"
            rows={closed}
            empty="No silence closed in the selected time range."
          >
            {row}
          </Section>
        </>
      )}
    </div>
  );
}
