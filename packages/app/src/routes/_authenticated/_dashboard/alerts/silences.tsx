import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { BellOff, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MatchersEditor } from "@/components/cc/matchers-editor";
import {
  CcConceptNote,
  CcEmptyState,
  CcQueryError,
  CcStatusDot,
  CcTableSkeleton,
  Conditions,
  ccErrorMessage,
  ccFormatTs,
} from "@/components/cc/shared";
import {
  createCcSilence,
  deleteCcSilence,
  listCcSilences,
} from "@/data/cc/server";
import type { CcMatcher, CcSilence } from "@/data/cc/types";

const silencesQuery = () =>
  queryOptions({
    queryKey: ["cc", "silences"],
    queryFn: () => listCcSilences(),
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/silences",
)({
  staticData: { breadcrumb: "Silences" },
  head: () => ({ meta: [{ title: "Everr - Alerts Silences" }] }),
  loader: ({ context: { queryClient } }) =>
    queryClient.prefetchQuery(silencesQuery()),
  component: CcSilencesPage,
});

function toRfc3339(local: string): string {
  return local ? new Date(local).toISOString() : "";
}

// Triage hands off a ready-made matcher set (the instance's labels plus the
// rule-scoping matcher) via router history state — search params can't be used
// because the dashboard route's schema strips unknown keys.
type SilenceHandoff = { silencePrefill?: CcMatcher[] };

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

function CcSilencesPage() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(silencesQuery());
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [matchers, setMatchers] = useState<CcMatcher[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [comment, setComment] = useState("");

  const openForMatchers = (seed: CcMatcher[]) => {
    setMatchers(seed);
    setStarts("");
    setEnds("");
    setComment("");
    setOpen(true);
  };

  // Open the dialog from the handoff state once, after mount (Base UI's Dialog
  // mishandles being born `open`, so we transition like a click would).
  const seededRef = useRef(false);
  useEffect(() => {
    const prefill = (location.state as SilenceHandoff)?.silencePrefill;
    if (prefill && !seededRef.current && prefill.length > 0) {
      seededRef.current = true;
      openForMatchers(prefill);
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot seed from navigation state
  }, [location.state]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["cc", "silences"] });
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
      invalidate();
      setOpen(false);
      setMatchers([]);
      setStarts("");
      setEnds("");
      setComment("");
      toast.success("Silence created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => deleteCcSilence({ data: { id } }),
    onSuccess: () => {
      invalidate();
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
    <div className="space-y-3">
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Silences</CardTitle>
          <CardAction>
            <Button onClick={() => openForMatchers([])}>
              <Plus data-icon="inline-start" />
              New silence
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <CcTableSkeleton rows={4} />
          ) : silences.length === 0 ? (
            <CcEmptyState
              icon={BellOff}
              title="No silences"
              hint="Silence a firing instance from Triage, or create one here to mute matching alerts for a window."
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New silence</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <CcConceptNote>
              Alerts whose labels match <em>all</em> of these matchers will be
              muted for the window below. An empty matcher set matches every
              alert.
            </CcConceptNote>
            <MatchersEditor value={matchers} onChange={setMatchers} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="silence-starts">Starts</Label>
                <Input
                  id="silence-starts"
                  type="datetime-local"
                  value={starts}
                  onChange={(e) => setStarts(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="silence-ends">Ends</Label>
                <Input
                  id="silence-ends"
                  type="datetime-local"
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                matchers.length === 0 || !starts || !ends || create.isPending
              }
              onClick={() => create.mutate()}
            >
              Create silence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
