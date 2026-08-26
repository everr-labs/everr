// PROTOTYPE, variant C: "Find a silence". Filter chips over one flat,
// newest-first table, with a side panel for the selected row. Built for the
// org with hundreds of silences a month, where grouping stops helping.
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { cn } from "@everr/ui/lib/utils";
import { BellOff, Plus, X } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  impact,
  relative,
  SILENCES,
  type SilenceFixture,
  type SilenceState,
  STATE_DOT,
  STATE_LABEL,
  scope,
  stamp,
} from "./fixture";

export const nameC = "Filterable table with detail";

const CHIPS: { key: SilenceState | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "scheduled", label: "Scheduled" },
  { key: "expired", label: "Expired" },
  { key: "cancelled", label: "Cancelled" },
];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function VariantC() {
  const [chip, setChip] = useState<SilenceState | "all">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const rows = SILENCES.filter(
    (s) =>
      (chip === "all" || s.state === chip) &&
      (q === "" ||
        `${s.rule ?? ""} ${s.matchers} ${s.comment} ${s.author}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  ).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const picked: SilenceFixture | null =
    SILENCES.find((s) => s.id === selected) ?? null;
  const counts = SILENCES.reduce<Record<string, number>>((acc, s) => {
    acc[s.state] = (acc[s.state] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <PageHeader
        title="Silences"
        icon={BellOff}
        lede="Silenced alerts stay visible but are not delivered."
        actions={
          <Button size="sm">
            <Plus className="size-4" />
            New silence
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                chip === c.key
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
              {c.key !== "all" && (
                <span className="ml-1 font-mono opacity-70">
                  {counts[c.key] ?? 0}
                </span>
              )}
            </button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rule, matcher, comment, author"
          className="h-7 max-w-72 text-xs"
        />
      </div>

      <div
        className={cn(
          "grid gap-4",
          picked ? "grid-cols-[minmax(0,1fr)_20rem]" : "grid-cols-1",
        )}
      >
        <table className="w-full text-sm">
          <thead className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b text-left">
              <th className="py-1.5 pr-3 font-normal">State</th>
              <th className="py-1.5 pr-3 font-normal">Rule</th>
              <th className="py-1.5 pr-3 font-normal">Scope</th>
              <th className="py-1.5 pr-3 font-normal">Starts</th>
              <th className="py-1.5 pr-3 font-normal">Duration</th>
              <th className="py-1.5 pr-3 font-normal">Author</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const ms =
                new Date(s.canceledAt ?? s.endsAt).getTime() -
                new Date(s.startsAt).getTime();
              const dur =
                ms >= 86_400_000
                  ? `${Math.round(ms / 86_400_000)}d`
                  : ms >= 3_600_000
                    ? `${Math.round(ms / 3_600_000)}h`
                    : `${Math.round(ms / 60_000)}m`;
              return (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={cn(
                    "cursor-pointer border-b transition-colors hover:bg-muted/25",
                    selected === s.id && "bg-muted/40",
                    s.state !== "active" &&
                      s.state !== "scheduled" &&
                      "text-muted-foreground",
                  )}
                >
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1.5 text-xs">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          STATE_DOT[s.state],
                        )}
                      />
                      {STATE_LABEL[s.state]}
                    </span>
                  </td>
                  <td className="max-w-56 truncate py-2 pr-3 font-medium">
                    {s.rule ?? (
                      <span className="font-normal italic">several rules</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{scope(s)}</td>
                  <td className="py-2 pr-3 font-mono text-xs tabular-nums">
                    {relative(s.startsAt)}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs tabular-nums">
                    {dur}
                  </td>
                  <td className="py-2 pr-3 text-xs">{s.author}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="py-6 text-center text-muted-foreground"
                >
                  No silences match.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {picked && (
          <aside className="h-fit space-y-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{picked.rule ?? "Several rules"}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      STATE_DOT[picked.state],
                    )}
                  />
                  {STATE_LABEL[picked.state]}
                  {picked.state === "active" &&
                    ` · ends ${relative(picked.endsAt)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              <Field label="Scope">
                <span className="font-mono text-xs">{scope(picked)}</span>
              </Field>
              <Field label="Window">
                <span className="font-mono text-xs tabular-nums">
                  {stamp(picked.startsAt)}
                  <br />→ {stamp(picked.canceledAt ?? picked.endsAt)}
                </span>
              </Field>
              <Field label="Impact">
                <span className="font-mono text-xs">
                  {impact(picked) ?? "none"}
                </span>
              </Field>
              <Field label="Comment">
                {picked.comment || (
                  <span className="text-muted-foreground">none</span>
                )}
              </Field>
              <Field label="Author">{picked.author}</Field>
            </div>
            <div className="flex gap-2 pt-1">
              {picked.state === "active" || picked.state === "scheduled" ? (
                <Button size="sm" variant="destructive">
                  Cancel silence
                </Button>
              ) : (
                <Button size="sm" variant="outline">
                  Silence again
                </Button>
              )}
              {picked.rule && (
                <Button size="sm" variant="ghost">
                  Open rule
                </Button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
