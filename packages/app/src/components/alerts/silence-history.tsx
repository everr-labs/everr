import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { BellOff } from "lucide-react";
import { Fragment, useState } from "react";
import type { AlertSilenceRecord } from "@/data/alerting/triage/view";
import type { SilenceCancelTarget } from "@/hooks/use-silence-controls";
import { Section } from "./detail-section";
import type { SilenceSeed } from "./silence-dialog";
import {
  cancelLabel,
  cancelTargetFor,
  isOpen,
  STATE_META,
  silenceAgainLabel,
  windowBounds,
} from "./silence-state";

/** Active first, then what is coming, then history. Within each group the
 *  server's newest-first order stands, except for scheduled silences, which
 *  are read as a queue: the one about to start matters most. */
const GROUP_ORDER: Record<AlertSilenceRecord["state"], number> = {
  active: 0,
  scheduled: 1,
  expired: 2,
  cancelled: 2,
};

/** A silence that has closed is evidence, not a control surface. Enough of
 *  them stay visible to answer "has this been muted before", and the rest
 *  wait behind a count so a noisy rule's history cannot push the sections
 *  below it off the panel. */
const CLOSED_PREVIEW = 4;

function sortSilences(
  silences: AlertSilenceRecord[],
  activeSilenceId: string | null,
): AlertSilenceRecord[] {
  return [...silences].sort((a, b) => {
    const group = GROUP_ORDER[a.state] - GROUP_ORDER[b.state];
    if (group !== 0) return group;
    // The silence the rule's status is attributed to leads its group: it is
    // the one the header is talking about.
    if (a.id === activeSilenceId) return -1;
    if (b.id === activeSilenceId) return 1;
    if (a.state === "scheduled") return a.startsAt.localeCompare(b.startsAt);
    return b.startsAt.localeCompare(a.startsAt);
  });
}

/** Its own element rather than a character written into either string: the
 *  facts on this line are set in two different faces, and a separator baked
 *  into a string takes that string's space width. */
const Separator = () => <span className="mx-1.5 opacity-60">·</span>;

function SilenceRow({
  record,
  rulePath,
  ruleLabel,
  inForce,
  pending,
  onCancel,
  onSilence,
}: {
  record: AlertSilenceRecord;
  /** The rule this panel is open on, and what a repeat falls back to when the
   *  silence itself names no single rule: it matched this one by its labels,
   *  so this rule is what "the same again" can mean. */
  rulePath: string;
  /** The rule's display name, for what the cancel toast calls this silence. */
  ruleLabel: string;
  /** This is the silence the rule's `silenced` status is attributed to, and
   *  more than one silence is active, so saying which is worth a badge. */
  inForce: boolean;
  pending: boolean;
  onCancel: (target: SilenceCancelTarget) => void;
  onSilence: (seed: SilenceSeed) => void;
}) {
  const meta = STATE_META[record.state];
  // A window that is still open can be closed early; one that has closed can
  // only be written again. Both are one button, in the same place, so the row
  // never has to explain which of the two it is offering.
  const open = isOpen(record.state);
  const bounds = windowBounds(record);
  const spoken = `${bounds.start.text} to ${bounds.end.text}`;
  // Only the facts this silence actually carries, so the row never prints a
  // placeholder for one it does not. A silence with no matchers is an
  // unnarrowed one, which the row already says by not narrowing it, and "no
  // comment, unknown author" reads as a person declining to explain
  // themselves: a claim the row is in no position to make.
  const facts = [
    record.scope ? { key: "matchers", text: record.scope, mono: true } : null,
    record.impact ? { key: "impact", text: record.impact, mono: true } : null,
    record.comment
      ? { key: "comment", text: record.comment, mono: false }
      : null,
    record.author ? { key: "author", text: record.author, mono: false } : null,
  ].filter((fact) => fact !== null);

  return (
    // The dot hangs in its own column rather than riding inside the label.
    // The panel is narrow enough that the facts wrap under the state on most
    // rows, and a wrapped line that starts at the dot instead of at the label
    // leaves the whole section looking a character left-ragged.
    <li className="grid grid-cols-[0.375rem_1fr] items-baseline gap-x-1.5 border-t py-2.5 first:border-t-0">
      <span className={cn("size-1.5 -translate-y-px rounded-full", meta.dot)} />
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={cn("shrink-0 text-xs font-medium", meta.text)}>
            {meta.label}
          </span>
          {/* The bounds themselves, not a phrase about them. The row is read
              against a timestamp from somewhere else, so it prints the two
              numbers that comparison needs. */}
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            <time dateTime={bounds.start.iso}>{bounds.start.text}</time>
            {" → "}
            <time dateTime={bounds.end.iso}>{bounds.end.text}</time>
          </span>
          {inForce && (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] leading-none text-muted-foreground">
              in force
            </span>
          )}
          {/* Everything else the row knows, as one more item in the same wrap
              group. Most silences carry one or two short facts, and a row that
              spent a whole second line on two words left the section looking
              left-ragged; as a wrap item the facts sit after the window when
              they fit and take their own line only when they have earned one.

              Mono for the facts the system derived, sans for the ones a person
              typed, which is how the panel's own header splits the two. The
              group's own gap is what separates it from the window, so nothing
              here opens with a dangling separator on the line it wraps to. */}
          {facts.length > 0 && (
            <span className="min-w-0 text-xs text-muted-foreground">
              {facts.map((fact, index) => (
                <Fragment key={fact.key}>
                  {index > 0 && <Separator />}
                  {fact.mono ? (
                    <span className="font-mono">{fact.text}</span>
                  ) : (
                    fact.text
                  )}
                </Fragment>
              ))}
            </span>
          )}
        </div>
        {/* Repeating a closed silence is offered on every past row, so it is
            toned to match them. Ending a live one is the single consequential
            action in the section and keeps full weight. */}
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={open ? cancelLabel(spoken) : silenceAgainLabel(spoken)}
          className={cn(
            "-my-1 -mr-2 shrink-0",
            !open && "font-normal text-muted-foreground hover:text-foreground",
          )}
          onClick={() =>
            open
              ? // Built in `silence-state`, so this row and the Silences page
                // cancel the same silence the same way. It used to substitute
                // the rule the panel happens to be open on when the silence
                // named none, which made Undo write a silence scoped to a rule
                // the reader had never muted.
                onCancel(cancelTargetFor(record, () => ruleLabel))
              : onSilence({
                  rule: record.rule ?? rulePath,
                  matchers: record.scope,
                  comment: record.comment,
                })
          }
        >
          {open ? "Cancel" : "Silence again"}
        </Button>
      </div>
    </li>
  );
}

/**
 * Every silence that overlapped the selected window, not only the one in
 * force. "Why did nobody get paged" is asked after the fact, and by then the
 * silence responsible has usually closed.
 *
 * The list is where silences are operated from, not just read: the header's
 * one button can only reach the silence the status is attributed to, which
 * leaves a scheduled silence, and the second of two overlapping ones, with no
 * way off the screen at all.
 */
export function SilenceHistory({
  silences,
  rulePath,
  ruleLabel,
  activeSilenceId,
  pending,
  onSilence,
  onCancel,
}: {
  silences: AlertSilenceRecord[];
  /** The rule the panel is open on. */
  rulePath: string;
  /** Its display name, for what the cancel toast calls the silence. */
  ruleLabel: string;
  activeSilenceId: string | null;
  /** A silence mutation is in flight. Every button here writes to the same
   *  rule, so they go inert together rather than racing each other. */
  pending: boolean;
  /** Opens the silence dialog on a seed. A closed row seeds it with its own
   *  scope and comment: the same noise coming back is the commonest reason
   *  anyone reads this section, and retyping the matchers is the commonest
   *  reason the replacement is scoped wrong. The header seeds an empty one. */
  onSilence: (seed: SilenceSeed) => void;
  onCancel: (target: SilenceCancelTarget) => void;
}) {
  const [showAllClosed, setShowAllClosed] = useState(false);
  const ordered = sortSilences(silences, activeSilenceId);
  const closedCount = ordered.filter((record) => !isOpen(record.state)).length;
  const hidden = showAllClosed ? 0 : Math.max(0, closedCount - CLOSED_PREVIEW);
  const visible =
    hidden === 0 ? ordered : ordered.slice(0, ordered.length - hidden);

  // Only worth marking when there is something to mistake it for. One active
  // silence is necessarily the one in force, and a badge saying so on the
  // only row it could describe is a word the reader has to rule out.
  const contested =
    ordered.filter((record) => record.state === "active").length > 1;

  return (
    <Section
      title={
        <>
          Silences
          {ordered.length > 0 && (
            // The list is bounded by the time range, which the empty state
            // says and the populated one used to leave the reader to guess.
            <span className="ml-2 font-mono tabular-nums text-muted-foreground/70">
              {ordered.length} in range
            </span>
          )}
        </>
      }
      aside={
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          className="-my-1 -mr-2"
          onClick={() =>
            onSilence({ rule: rulePath, matchers: "", comment: "" })
          }
        >
          <BellOff data-icon="inline-start" />
          Silence rule
        </Button>
      }
    >
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No silence covered this rule in the selected time range.
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {visible.map((record) => (
              <SilenceRow
                key={record.id}
                record={record}
                rulePath={rulePath}
                ruleLabel={ruleLabel}
                inForce={contested && record.id === activeSilenceId}
                pending={pending}
                onCancel={onCancel}
                onSilence={onSilence}
              />
            ))}
          </ul>
          {hidden > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="-mb-1 mt-1 -ml-2 font-normal text-muted-foreground hover:text-foreground"
              onClick={() => setShowAllClosed(true)}
            >
              Show {hidden} older
            </Button>
          )}
        </>
      )}
    </Section>
  );
}
