import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
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
import { Label } from "@everr/ui/components/label";
import { Textarea } from "@everr/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type Ref, useImperativeHandle, useState } from "react";
import { toast } from "sonner";
import { silenceQueries } from "@/data/alerting/silences/queries";
import {
  createAlertingSilence,
  deleteAlertingSilence,
} from "@/data/alerting/silences/server";
import type { AlertingMatcher, AlertingSilence } from "@/data/alerting/types";
import { MatchersEditor, matchersAreScoped } from "../delivery/matchers-editor";
import {
  AlertingConceptNote,
  AlertingQueryError,
  AlertingTableSkeleton,
  alertingErrorMessage,
  alertingFormatTs,
} from "../shared/components";
import { AlertingDrawer } from "../shared/drawer";
import { Conditions } from "../shared/signal";
import { AlertingStatusLabel } from "../shared/status";

/**
 * Imperative on purpose: the drawer resets its own form state inside
 * `openWith`, so no prop-reactive state resets are needed.
 */
export type SilenceDrawerOptions = {
  lockSeed?: boolean;
  seedValueLabels?: readonly (string | undefined)[];
};

export type SilenceDrawerHandle = {
  openWith: (seed: AlertingMatcher[], options?: SilenceDrawerOptions) => void;
};

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

function groupOf(s: AlertingSilence, now: number): SilenceGroup {
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

const SILENCE_TONE = {
  active: "healthy",
  scheduled: "info",
  expired: "muted",
} as const;

export function SilencesPanel({ onNewSilence }: { onNewSilence: () => void }) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(silenceQueries.list());

  const cancel = useMutation({
    mutationFn: (id: string) => deleteAlertingSilence({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: silenceQueries.list().queryKey });
      toast.success("Silence cancelled");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
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
  }): Column<AlertingSilence>[] => [
    {
      header: "State",
      cell: () => (
        <AlertingStatusLabel tone={SILENCE_TONE[g.key]} muted>
          {g.key}
        </AlertingStatusLabel>
      ),
    },
    {
      header: "Matchers",
      cell: (s) => <Conditions matchers={s.matchers} />,
    },
    { header: "Starts", cell: (s) => alertingFormatTs(s.starts_at) },
    { header: "Ends", cell: (s) => alertingFormatTs(s.ends_at) },
    {
      header: "Comment",
      cell: (s) => (
        <div className="space-y-0.5">
          <div>
            {s.comment ?? <span className="text-muted-foreground">—</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {[
              s.author ? `by ${s.author}` : null,
              s.created_at ? `created ${alertingFormatTs(s.created_at)}` : null,
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
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
              Cancel
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel silence?</AlertDialogTitle>
                <AlertDialogDescription>
                  Matching alerts may be delivered again immediately. This
                  silence was scheduled to end {alertingFormatTs(s.ends_at)}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep silence</AlertDialogCancel>
                <AlertDialogCancel
                  variant="destructive"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(s.id)}
                >
                  Cancel silence
                </AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null,
    },
  ];

  if (isError) return <AlertingQueryError error={error} />;

  return (
    <Card
      inset="flush-content"
      size={silences.length === 0 && !isPending ? "sm" : "default"}
      id="silences"
      className="scroll-mt-4"
    >
      <CardHeader>
        <CardTitle>
          <h2>Silences</h2>
        </CardTitle>
        <CardDescription>
          {silences.length === 0 && !isPending
            ? "No active silences."
            : "Silenced alerts stay visible but are not delivered."}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            className="min-h-11 md:min-h-8"
            onClick={onNewSilence}
          >
            <Plus data-icon="inline-start" />
            New silence
          </Button>
        </CardAction>
      </CardHeader>
      {(isPending || silences.length > 0) && (
        <CardContent>
          {isPending ? (
            <AlertingTableSkeleton rows={3} />
          ) : (
            <div className="space-y-1">
              {grouped.map((g) => (
                <section key={g.key}>
                  <h3 className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
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
      )}
    </Card>
  );
}

// ── Create drawer ─────────────────────────────────────────────────────────────

type SilenceDuration = "1h" | "8h" | "24h" | "custom";

const SILENCE_DURATIONS: readonly {
  value: SilenceDuration;
  label: string;
  hours?: number;
}[] = [
  { value: "1h", label: "1h", hours: 1 },
  { value: "8h", label: "8h", hours: 8 },
  { value: "24h", label: "24h", hours: 24 },
  { value: "custom", label: "Custom" },
];

export function SilenceCreateDrawer({
  ref,
}: {
  ref: Ref<SilenceDrawerHandle>;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [matchers, setMatchers] = useState<AlertingMatcher[]>([]);
  const [lockedMatcherCount, setLockedMatcherCount] = useState(0);
  const [lockedValueLabels, setLockedValueLabels] = useState<
    readonly (string | undefined)[]
  >([]);
  const [duration, setDuration] = useState<SilenceDuration>("1h");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [comment, setComment] = useState("");

  useImperativeHandle(
    ref,
    () => ({
      openWith: (seed, options) => {
        setMatchers(seed);
        setLockedMatcherCount(options?.lockSeed ? seed.length : 0);
        setLockedValueLabels(options?.seedValueLabels ?? []);
        const now = new Date();
        setDuration("1h");
        setStarts(toLocalInput(now));
        setEnds(toLocalInput(new Date(now.getTime() + 3_600_000)));
        setComment("");
        setOpen(true);
      },
    }),
    [],
  );

  const selectDuration = (next: SilenceDuration) => {
    setDuration(next);
    const preset = SILENCE_DURATIONS.find((item) => item.value === next);
    if (preset?.hours === undefined) return;
    const now = new Date();
    setStarts(toLocalInput(now));
    setEnds(toLocalInput(new Date(now.getTime() + preset.hours * 3_600_000)));
  };
  const startsMs = Date.parse(starts);
  const endsMs = Date.parse(ends);
  const windowIsValid =
    Number.isFinite(startsMs) && Number.isFinite(endsMs) && endsMs > startsMs;
  const invalidWindow = starts !== "" && ends !== "" && !windowIsValid;

  const create = useMutation({
    mutationFn: () =>
      createAlertingSilence({
        data: {
          matchers,
          starts_at: toRfc3339(starts),
          ends_at: toRfc3339(ends),
          comment: comment || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: silenceQueries.list().queryKey });
      setOpen(false);
      toast.success("Silence created");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  return (
    <AlertingDrawer
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
              !matchersAreScoped(matchers) || !windowIsValid || create.isPending
            }
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating silence" : "Create silence"}
          </Button>
        </>
      }
    >
      {lockedMatcherCount === 0 && (
        <AlertingConceptNote>
          Alerts matching every condition will be muted for the selected window.
          At least one matcher is required.
        </AlertingConceptNote>
      )}
      <MatchersEditor
        value={matchers}
        onChange={setMatchers}
        lockedCount={lockedMatcherCount}
        lockedValueLabels={lockedValueLabels}
      />
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Duration</span>
        <ToggleGroup
          value={[duration]}
          variant="outline"
          size="lg"
          spacing={0}
          className="w-full"
          aria-label="Silence duration"
          onValueChange={(values) => {
            const next = values[0];
            if (
              next === "1h" ||
              next === "8h" ||
              next === "24h" ||
              next === "custom"
            ) {
              selectDuration(next);
            }
          }}
        >
          {SILENCE_DURATIONS.map((item) => (
            <ToggleGroupItem
              key={item.value}
              value={item.value}
              className="h-10 min-w-0 flex-1"
            >
              {item.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="silence-starts">Starts</Label>
          <DateTimePicker
            id="silence-starts"
            value={starts}
            onChange={(value) => {
              setStarts(value);
              setDuration("custom");
            }}
            placeholder="Pick a start"
            timeLabel="Start time"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="silence-ends">Ends</Label>
          <DateTimePicker
            id="silence-ends"
            value={ends}
            onChange={(value) => {
              setEnds(value);
              setDuration("custom");
            }}
            placeholder="Pick an end"
            timeLabel="End time"
          />
        </div>
      </div>
      {invalidWindow && (
        <p className="text-xs text-destructive" role="alert">
          End time must be after start time.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="silence-comment">Comment</Label>
        <Textarea
          id="silence-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Why is this alert being silenced?"
        />
      </div>
    </AlertingDrawer>
  );
}
