/**
 * The two cells every list of silences prints the same way: the window a
 * silence covers, and the one button a row offers. Shared so the detail's
 * list and the Silences page cannot drift apart on what a row lets you do.
 */
import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import type { AlertSilenceRecord } from "@/data/alerting/triage/view";
import type { SilenceCancelTarget } from "@/hooks/use-silence-controls";
import type { SilenceSeed } from "./silence-dialog";
import {
  cancelLabel,
  cancelTargetFor,
  isOpen,
  silenceAgainLabel,
  type WindowBounds,
} from "./silence-state";

/**
 * Both bounds, not a phrase about them. A silence row is read against a
 * timestamp from somewhere else, so it prints the two numbers that comparison
 * needs.
 */
export function SilenceWindow({
  bounds,
  className,
}: {
  /** From `windowBounds`, which the row already computed for its label. */
  bounds: WindowBounds;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      <time dateTime={bounds.start.iso}>{bounds.start.text}</time>
      {" → "}
      <time dateTime={bounds.end.iso}>{bounds.end.text}</time>
    </span>
  );
}

/**
 * A window that is still open can be closed early; one that has closed can
 * only be written again. Both are one button, in the same place, so the row
 * never has to explain which of the two it is offering.
 *
 * Repeating a closed silence is offered on every past row, so it is toned to
 * match them. Ending a live one is the single consequential action in the
 * list and keeps full weight.
 */
export function SilenceRowAction({
  record,
  spoken,
  ruleName,
  seedRule,
  pending,
  className,
  ref,
  onCancel,
  onSilence,
}: {
  record: AlertSilenceRecord;
  /** What the button's label calls this silence out loud. Every row offers
   *  the same two words, so the label has to carry the silence it belongs to. */
  spoken: string;
  /** The rule's display name, for what the cancel toast calls the silence. */
  ruleName: (path: string) => string;
  /** The rule a repeat is written against when the silence itself names none.
   *  The detail panel is open on one, which is what "the same again" can mean
   *  there; the Silences page has none to assume, and the dialog offers the
   *  choice itself. */
  seedRule: string | null;
  pending: boolean;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
  onCancel: (target: SilenceCancelTarget) => void;
  onSilence: (seed: SilenceSeed) => void;
}) {
  const open = isOpen(record.state);
  return (
    <Button
      ref={ref}
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={open ? cancelLabel(spoken) : silenceAgainLabel(spoken)}
      className={cn(
        className,
        !open && "font-normal text-muted-foreground hover:text-foreground",
      )}
      onClick={() =>
        open
          ? // Built in `silence-state`, so every list cancels the same silence
            // the same way, and Undo restores only the scope the silence
            // itself named.
            onCancel(cancelTargetFor(record, ruleName))
          : onSilence({
              rule: record.rule ?? seedRule,
              matchers: record.scope,
              comment: record.comment,
            })
      }
    >
      {open ? "Cancel" : "Silence again"}
    </Button>
  );
}
