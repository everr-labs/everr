import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { useState } from "react";
import { SILENCE_DURATIONS } from "@/data/alerting/triage/view";

export type SilenceDraft = {
  path: string;
  duration: string;
  matchers: string;
  comment: string;
};

/**
 * Silencing is the one destructive-ish act available from triage, so it asks
 * before it acts and says what it will and will not stop. Three fields, all of
 * them defaulted: a duration (silences always expire), matchers (empty means
 * the whole rule) and a comment (`comment`/`author` are columns on the silence
 * row, and an unexplained silence is how alerting rots).
 */
export function SilenceDialog({
  path,
  seed,
  instanceCount,
  pending,
  onClose,
  onConfirm,
}: {
  /** The rule being silenced, or `null` when the dialog is closed. */
  path: string | null;
  /** Starting matchers and comment, when the dialog was opened from a silence
   *  that has already closed. The caller remounts the dialog per opening (see
   *  the `key` at the call site), so these are read once, as the initial state
   *  of fields the reader then owns. */
  seed?: { matchers: string; comment: string };
  /** How many instances the rule currently has, for the matcher preview. */
  instanceCount: number;
  /** The silence is being written. The dialog stays open and inert until the
   *  server answers: closing early would leave the reader unsure it happened. */
  pending: boolean;
  onClose: () => void;
  onConfirm: (draft: SilenceDraft) => void;
}) {
  const [duration, setDuration] = useState("1h");
  const [matchers, setMatchers] = useState(seed?.matchers ?? "");
  const [comment, setComment] = useState(seed?.comment ?? "");

  // A degraded rule has no instances to count, so the preview names the scope
  // rather than claiming it matches nothing.
  const scope = matchers.trim()
    ? `matches instances where ${matchers.trim()}`
    : instanceCount > 0
      ? `matches all ${instanceCount} instances`
      : "matches the whole rule";

  return (
    <Dialog
      open={path !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Silence alert</DialogTitle>
          <DialogDescription>
            Notifications stop. The rule keeps evaluating, and held
            notifications are marked{" "}
            <span className="font-mono">suppressed</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Rule</Label>
            <p className="font-mono text-sm">{path}</p>
          </div>

          <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="silence-duration">Duration</Label>
              <Select
                value={duration}
                onValueChange={(v) => setDuration(v ?? "1h")}
              >
                <SelectTrigger id="silence-duration" className="w-full">
                  <SelectValue>{duration}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SILENCE_DURATIONS.map((d) => (
                    <SelectItem key={d.label} value={d.label}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="silence-matchers">Matchers</Label>
              <Input
                id="silence-matchers"
                value={matchers}
                onChange={(e) => setMatchers(e.target.value)}
                placeholder="empty = whole rule"
                autoComplete="off"
              />
            </div>
          </div>
          {/* Both fields answer the same question ("what am I about to turn
              off, and until when?"), so one line answers it under both rather
              than two hints splitting the reader's attention. */}
          <p className="text-xs text-muted-foreground">
            Silences for {duration} · {scope}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="silence-comment">Comment</Label>
            <Input
              id="silence-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Why this is silenced"
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (path) onConfirm({ path, duration, matchers, comment });
            }}
          >
            {pending ? "Silencing…" : `Silence for ${duration}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
