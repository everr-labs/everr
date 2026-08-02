// packages/app/src/routes/_authenticated/_dashboard/_previewable/alerts/-components/silences-panel.tsx
//
// Silence management, embedded on the Triage page — muting lives where muting
// happens. The panel lists silences grouped by lifecycle (active, scheduled,
// recently expired); the create drawer is owned by the page so quick actions
// on firing instances ("Custom" silence) can open it pre-seeded without a
// navigation handoff.
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { DateTimePicker } from "@everr/ui/components/date-time-picker";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Plus } from "lucide-react";
import { type Ref, useImperativeHandle, useState } from "react";
import { toast } from "sonner";
import { ccQueries } from "@/data/cc/queries";
import { createCcSilence, deleteCcSilence } from "@/data/cc/server";
import type { CcMatcher, CcSilence } from "@/data/cc/types";
import { CcDrawer } from "./cc-drawer";
import { MatchersEditor, matchersAreScoped } from "./matchers-editor";
import {
  CcConceptNote,
  CcEmptyState,
  CcQueryError,
  CcStatusDot,
  CcTableSkeleton,
  Conditions,
  ccErrorMessage,
  ccFormatTs,
} from "./shared";

/**
 * Imperative handle for the create drawer: opening is always an explicit user
 * action, so the owner calls `openWith(seed)` and the drawer resets its own
 * form state on the way in — no prop-reactive state resets.
 */
export type SilenceDrawerHandle = { openWith: (seed: CcMatcher[]) => void };

function toRfc3339(local: string): string {
  return local ? new Date(local).toISOString() : "";
}

/** A Date as a `DateTimePicker` value (local time, minute precision). */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type SilenceGroup = "active" | "scheduled" | "expired";

function groupOf(s: CcSilence, now: number): SilenceGroup {
  const starts = new Date(s.starts_at).getTime();
  const ends = new Date(s.ends_at).getTime();
  if (starts <= now && now < ends) return "active";
  return now < starts ? "scheduled" : "expired";
}

const GROUPS: {
  key: SilenceGroup;
  title: string;
  cancellable: boolean;
}[] = [
  { key: "active", title: "Active", cancellable: true },
  { key: "scheduled", title: "Scheduled", cancellable: true },
  { key: "expired", title: "Recently expired", cancellable: false },
];

export function SilencesPanel({
  onNewSilence,
}: {
  /** Open the page-owned create drawer, optionally pre-seeded. */
  onNewSilence: () => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.silences());

  const cancel = useMutation({
    mutationFn: (id: string) => deleteCcSilence({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.silences().queryKey });
      toast.success("Silence cancelled");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const now = Date.now();
  const silences = data ?? [];
  const grouped = GROUPS.map((g) => ({
    ...g,
    rows: silences
      .filter((s) => groupOf(s, now) === g.key)
      .sort((a, b) =>
        // Active/scheduled: soonest-ending/starting first; expired: newest first.
        g.key === "expired"
          ? b.ends_at.localeCompare(a.ends_at)
          : a.ends_at.localeCompare(b.ends_at),
      ),
  })).filter((g) => g.rows.length > 0);

  const columns = (g: {
    key: SilenceGroup;
    cancellable: boolean;
  }): Column<CcSilence>[] => [
    {
      header: "State",
      cell: () =>
        g.key === "active" ? (
          <span className="inline-flex items-center gap-1.5">
            <CcStatusDot tone="healthy" />
            active
          </span>
        ) : g.key === "scheduled" ? (
          <span className="inline-flex items-center gap-1.5">
            <CcStatusDot tone="pending" />
            scheduled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <CcStatusDot tone="inactive" />
            expired
          </span>
        ),
    },
    {
      header: "Matchers",
      cell: (s) => <Conditions matchers={s.matchers} />,
    },
    { header: "Starts", cell: (s) => ccFormatTs(s.starts_at) },
    { header: "Ends", cell: (s) => ccFormatTs(s.ends_at) },
    {
      header: "Comment",
      cell: (s) => (
        <div className="space-y-0.5">
          <div>
            {s.comment ?? <span className="text-muted-foreground">—</span>}
          </div>
          {/* Provenance: who created the silence, and when. */}
          <div className="text-xs text-muted-foreground">
            {[
              s.author ? `by ${s.author}` : null,
              s.created_at ? `created ${ccFormatTs(s.created_at)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      ),
    },
    {
      header: "",
      cell: (s) =>
        g.cancellable ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(s.id)}
          >
            Cancel
          </Button>
        ) : null,
    },
  ];

  if (isError) return <CcQueryError error={error} />;

  return (
    <Card inset="flush-content" id="silences" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Silences</CardTitle>
        <CardDescription>
          Muting windows: alerts matching a silence stay visible here but are
          not delivered.
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={onNewSilence}>
            <Plus data-icon="inline-start" />
            New silence
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <CcTableSkeleton rows={3} />
        ) : silences.length === 0 ? (
          <CcEmptyState
            icon={BellOff}
            title="No silences"
            hint="Silence a firing instance from the board above, or create one here to mute matching alerts for a window."
          />
        ) : (
          <div className="space-y-1">
            {grouped.map((g) => (
              <section key={g.key}>
                <h3 className="px-3 pt-2 pb-1 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                  {g.title}
                </h3>
                <DataTable
                  data={g.rows}
                  columns={columns(g)}
                  rowKey={(s) => s.id}
                />
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Create drawer ─────────────────────────────────────────────────────────────

export function SilenceCreateDrawer({
  ref,
}: {
  ref: Ref<SilenceDrawerHandle>;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [matchers, setMatchers] = useState<CcMatcher[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [comment, setComment] = useState("");

  useImperativeHandle(
    ref,
    () => ({
      openWith: (seed) => {
        setMatchers(seed);
        // Silences almost always start immediately: prefill "now" so the
        // common case is one duration click away, not two datetime fields.
        setStarts(toLocalInput(new Date()));
        setEnds("");
        setComment("");
        setOpen(true);
      },
    }),
    [],
  );

  // Duration presets: end = start (or now) + h. The pickers stay for the odd
  // shape (a maintenance window next Tuesday); presets carry the common case.
  const applyDuration = (h: number) => {
    const base = starts ? new Date(starts) : new Date();
    if (!starts) setStarts(toLocalInput(base));
    setEnds(toLocalInput(new Date(base.getTime() + h * 3_600_000)));
  };

  const create = useMutation({
    mutationFn: () =>
      createCcSilence({
        data: {
          matchers,
          starts_at: toRfc3339(starts),
          ends_at: toRfc3339(ends),
          comment: comment || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.silences().queryKey });
      setOpen(false);
      toast.success("Silence created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <CcDrawer
      open={open}
      onOpenChange={setOpen}
      title="New silence"
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !matchersAreScoped(matchers) ||
              !starts ||
              !ends ||
              create.isPending
            }
            onClick={() => create.mutate()}
          >
            Create silence
          </Button>
        </>
      }
    >
      <CcConceptNote>
        Alerts whose labels match <em>all</em> of these matchers will be muted
        for the window below. At least one matcher is required — a silence is
        always scoped.
      </CcConceptNote>
      <MatchersEditor value={matchers} onChange={setMatchers} />
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Duration</span>
        <div className="flex items-center gap-1.5">
          {[1, 8, 24].map((h) => (
            <Button
              key={h}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyDuration(h)}
            >
              {h}h
            </Button>
          ))}
          <span className="pl-1 text-xs text-muted-foreground">
            or set the window below
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="silence-starts">Starts</Label>
          <DateTimePicker
            id="silence-starts"
            value={starts}
            onChange={setStarts}
            placeholder="Pick a start"
            timeLabel="Start time"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="silence-ends">Ends</Label>
          <DateTimePicker
            id="silence-ends"
            value={ends}
            onChange={setEnds}
            placeholder="Pick an end"
            timeLabel="End time"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="silence-comment">Comment</Label>
        <Input
          id="silence-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="maintenance window"
        />
      </div>
    </CcDrawer>
  );
}
