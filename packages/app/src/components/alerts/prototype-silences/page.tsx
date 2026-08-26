// PROTOTYPE, on fixture data: "What is muting right now". Three stacked
// sections (active, coming up, history) with one dense grid row per silence.
// The active section is the control surface; history is evidence.
import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { BellOff, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  impact,
  relative,
  SILENCES,
  type SilenceFixture,
  STATE_DOT,
  STATE_LABEL,
  stamp,
} from "./fixture";

const COLUMNS =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_7rem_6rem] items-center gap-4";
const COLUMN_LABEL =
  "font-mono text-[0.6875rem] tracking-wider text-muted-foreground uppercase";

function Row({ s }: { s: SilenceFixture }) {
  const open = s.state === "active" || s.state === "scheduled";
  return (
    <div
      className={cn(
        COLUMNS,
        "border-t px-3 py-2.5 text-sm transition-colors hover:bg-muted/25",
        !open && "text-muted-foreground",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[s.state])}
          />
          {/* The matchers are the silence: there is no name to put above
              them, and the rule is one matcher among the others rather than a
              title the rest narrow. A silence with none prints nothing here;
              absence of text is the statement. */}
          {s.matchers && (
            <span className="truncate font-mono text-xs">{s.matchers}</span>
          )}
        </div>
        {s.comment && (
          <p className="mt-0.5 truncate pl-3.5 text-xs text-muted-foreground">
            {s.comment}
          </p>
        )}
      </div>
      <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
        {stamp(s.startsAt)} → {stamp(s.canceledAt ?? s.endsAt)}
      </span>
      <span className="font-mono text-xs tabular-nums">
        {s.state === "active"
          ? `ends ${relative(s.endsAt)}`
          : s.state === "scheduled"
            ? `starts ${relative(s.startsAt)}`
            : STATE_LABEL[s.state]}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {impact(s) ?? "—"}
      </span>
      <div className="text-right">
        <Button
          size="sm"
          variant="ghost"
          className={cn("-my-1", !open && "font-normal text-muted-foreground")}
        >
          {open ? "Cancel" : "Silence again"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  rows,
}: {
  title: string;
  hint?: string;
  rows: SilenceFixture[];
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
          Nothing here.
        </p>
      ) : (
        rows.map((s) => <Row key={s.id} s={s} />)
      )}
    </section>
  );
}

export function SilencesPage() {
  const active = SILENCES.filter((s) => s.state === "active");
  const scheduled = SILENCES.filter((s) => s.state === "scheduled").sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt),
  );
  const closed = SILENCES.filter(
    (s) => s.state === "expired" || s.state === "cancelled",
  );
  const held = active.reduce((n, s) => n + s.held, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Silences"
        icon={BellOff}
        lede={`${active.length} active, holding ${held} notifications. Silenced alerts stay visible but are not delivered.`}
        actions={
          <Button size="sm">
            <Plus className="size-4" />
            New silence
          </Button>
        }
      />
      <Section title="Active" rows={active} />
      <Section title="Coming up" hint="soonest first" rows={scheduled} />
      <Section title="History" hint="last 90 days" rows={closed} />
    </div>
  );
}
