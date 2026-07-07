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
  createCcSilence,
  deleteCcSilence,
  listCcSilences,
} from "@/data/cc/server";
import type { CcMatcher, CcSilence } from "@/data/cc/types";
import {
  CcConceptNote,
  CcEmptyState,
  CcQueryError,
  CcStatusDot,
  CcTableSkeleton,
  ccErrorMessage,
  ccFormatTs,
} from "../-cc-shared";

const silencesQuery = () =>
  queryOptions({
    queryKey: ["cc", "silences"],
    queryFn: () => listCcSilences(),
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/monitor/silences",
)({
  loader: ({ context: { queryClient } }) =>
    queryClient.prefetchQuery(silencesQuery()),
  component: CcMonitorSilences,
});

function toRfc3339(local: string): string {
  return local ? new Date(local).toISOString() : "";
}

// The Active view hands off a label map via router history state (search params
// can't be used — the dashboard route's schema strips unknown keys).
type SilenceHandoff = { silencePrefill?: Record<string, string> };

function seedMatchers(labels: Record<string, string>): CcMatcher[] {
  return Object.entries(labels)
    .filter(([, v]) => typeof v === "string")
    .map(([label, value]) => ({ label, op: "eq" as const, value }));
}

function CcMonitorSilences() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(silencesQuery());
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [matchers, setMatchers] = useState<CcMatcher[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [comment, setComment] = useState("");

  const openForLabels = (labels: Record<string, string>) => {
    setMatchers(seedMatchers(labels));
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
    if (prefill && !seededRef.current && Object.keys(prefill).length > 0) {
      seededRef.current = true;
      openForLabels(prefill);
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
  const isActive = (s: CcSilence) =>
    new Date(s.starts_at).getTime() <= now &&
    now < new Date(s.ends_at).getTime();

  const columns: Column<CcSilence>[] = [
    {
      header: "State",
      cell: (s) =>
        isActive(s) ? (
          <span className="inline-flex items-center gap-1.5">
            <CcStatusDot tone="healthy" />
            active
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
      cell: (s) => (
        <span className="font-mono text-xs">
          {s.matchers.map((m) => `${m.label}${m.op}${m.value}`).join(", ")}
        </span>
      ),
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
      cell: (s) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(s.id)}
        >
          Cancel
        </Button>
      ),
    },
  ];

  if (isError) return <CcQueryError error={error} />;

  return (
    <div className="space-y-3">
      <CcConceptNote>
        Silences mute alerts whose labels match a set of matchers, for a time
        window — use them for maintenance and known noise. You can also silence
        any firing alert directly from the <strong>Active</strong> view.
      </CcConceptNote>
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Silences</CardTitle>
          <CardAction>
            <Button onClick={() => openForLabels({})}>
              <Plus data-icon="inline-start" />
              New silence
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <CcTableSkeleton rows={4} />
          ) : (
            <DataTable
              data={data ?? []}
              columns={columns}
              rowKey={(s) => s.id}
              emptyState={
                <CcEmptyState
                  icon={BellOff}
                  title="No silences"
                  hint="Silence a firing alert from the Active view, or create one here to mute matching alerts for a window."
                />
              }
            />
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
