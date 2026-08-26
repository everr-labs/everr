// PROTOTYPE, variant B: "When was what muted". A Gantt-style timeline: one
// swimlane per rule, each silence a bar against a shared time axis with a
// "now" line. Answers "was anything silencing at 13:05" by eye.
import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { BellOff, Plus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  FIXTURE_NOW,
  impact,
  relative,
  SILENCES,
  type SilenceFixture,
  STATE_LABEL,
  scope,
  stamp,
} from "./fixture";

export const nameB = "Timeline by rule";

const WINDOWS = [
  { label: "24h", past: 24, future: 6 },
  { label: "7d", past: 24 * 7, future: 24 * 2 },
  { label: "30d", past: 24 * 30, future: 24 * 4 },
] as const;

const BAR: Record<SilenceFixture["state"], string> = {
  active: "bg-chart-2",
  scheduled: "border border-dashed border-chart-2 bg-chart-2/15",
  expired: "bg-muted-foreground/35",
  cancelled: "border border-muted-foreground/50 bg-transparent",
};

export function VariantB() {
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(WINDOWS[1]);
  const [selected, setSelected] = useState<string | null>("sil_01");
  const now = FIXTURE_NOW.getTime();
  const from = now - win.past * 3_600_000;
  const to = now + win.future * 3_600_000;
  const span = to - from;
  const pct = (t: number) =>
    `${Math.min(100, Math.max(0, ((t - from) / span) * 100))}%`;

  const lanes = new Map<string, SilenceFixture[]>();
  for (const s of SILENCES) {
    const key = s.rule ?? "Several rules";
    lanes.set(key, [...(lanes.get(key) ?? []), s]);
  }
  // Rules with something in force first, then by name.
  const ordered = [...lanes.entries()].sort(([a, as], [b, bs]) => {
    const ax = as.some((s) => s.state === "active") ? 0 : 1;
    const bx = bs.some((s) => s.state === "active") ? 0 : 1;
    return ax - bx || a.localeCompare(b);
  });
  const picked = SILENCES.find((s) => s.id === selected) ?? null;

  const ticks = 6;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Silences"
        icon={BellOff}
        lede="Every silence over the window, per rule. Solid is in force, dashed is scheduled, grey is history."
        actions={
          <>
            <div className="flex rounded-md border p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => setWin(w)}
                  className={cn(
                    "rounded-sm px-2 py-0.5 font-mono text-xs",
                    w.label === win.label
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <Button size="sm">
              <Plus className="size-4" />
              New silence
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-x-3">
        {/* axis */}
        <span />
        <div className="relative h-5 border-b font-mono text-[0.6875rem] text-muted-foreground">
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const t = from + (span * i) / ticks;
            return (
              <span
                key={t}
                className="absolute -translate-x-1/2"
                style={{ left: pct(t) }}
              >
                {new Date(t).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </span>
            );
          })}
        </div>

        {ordered.map(([rule, rows]) => (
          <div key={rule} className="contents">
            <div className="flex items-center border-b py-2 text-sm">
              <span className="truncate" title={rule}>
                {rule}
              </span>
            </div>
            <div className="relative h-10 border-b">
              <span
                className="absolute inset-y-0 w-px bg-destructive/70"
                style={{ left: pct(now) }}
              />
              {rows.map((s) => {
                const a = new Date(s.startsAt).getTime();
                const b = new Date(s.canceledAt ?? s.endsAt).getTime();
                if (b < from || a > to) return null;
                const left = ((Math.max(a, from) - from) / span) * 100;
                const right = ((Math.min(b, to) - from) / span) * 100;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelected(s.id)}
                    title={`${STATE_LABEL[s.state]} · ${scope(s)}`}
                    className={cn(
                      "absolute top-2.5 h-5 min-w-1 rounded-sm outline-2 outline-dotted outline-transparent focus-visible:outline-primary",
                      BAR[s.state],
                      selected === s.id && "ring-2 ring-primary ring-offset-1",
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(0.4, right - left)}%`,
                    }}
                  >
                    <span className="sr-only">
                      {stamp(s.startsAt)} to {stamp(s.endsAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {picked && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2.5 text-sm">
          <div className="space-y-1">
            <p className="flex items-center gap-2">
              <span className="font-medium">
                {picked.rule ?? "Several rules"}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {scope(picked)}
              </span>
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] leading-none text-muted-foreground">
                {STATE_LABEL[picked.state]}
              </span>
            </p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {stamp(picked.startsAt)} →{" "}
              {stamp(picked.canceledAt ?? picked.endsAt)}
              {picked.state === "active" &&
                ` · ends ${relative(picked.endsAt)}`}
              {impact(picked) && ` · ${impact(picked)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {picked.comment || "No comment"} · {picked.author}
            </p>
          </div>
          <Button
            size="sm"
            variant={picked.state === "active" ? "default" : "ghost"}
          >
            {picked.state === "active" || picked.state === "scheduled"
              ? "Cancel"
              : "Silence again"}
          </Button>
        </div>
      )}
    </div>
  );
}
