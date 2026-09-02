import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "@/data/alerting/triage/format";
import {
  type AlertSilenceRecord,
  SILENCE_PAGE_LIMIT,
} from "@/data/alerting/triage/view";
import type { SilenceCancelTarget } from "@/hooks/use-silence-controls";
import { COLUMN_LABEL } from "./list-columns";
import { ROW_TARGET } from "./list-row";
import type { SilenceSeed } from "./silence-dialog";
import { SilenceRowAction, SilenceWindow } from "./silence-row";
import { isOpen, STATE_META, spokenSilence } from "./silence-state";

/**
 * Measured against the list column rather than the window, the same way the
 * triage list and the rule inventory are: narrow, the row is what is silenced
 * and the button, with the times and the impact reflowed onto a line of their
 * own underneath; at full width it is the table. Each fact is rendered once
 * either way, so nothing here can print two different answers at two sizes.
 *
 * The wide template is built from whether an impact column exists, because a
 * track declared for a cell nobody fills is not empty space, it is the table
 * stopping short of its own right edge. Only the identity column flexes: the
 * window, the state and the action all print content of a known width, and
 * giving them a share of the slack only pushed them away from each other.
 *
 * Centred at both tiers. The identity cell is two lines on nearly every row
 * (three when a silence carries matchers, an author and a comment), and
 * baseline alignment left the date, state and action riding the top line
 * with the row's bottom half empty beside them. Centring keeps the four cells
 * at the row's middle, which is where the eye lands on a two-line row.
 */
const COLUMNS_BASE =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5";

/** Both templates, resolved once for the process rather than per row per
 *  render: `impact` has two values, and `cn` runs tailwind-merge. */
const COLUMNS = {
  withImpact: cn(
    COLUMNS_BASE,
    "@[52rem]/list:grid-cols-[minmax(0,1fr)_13rem_9rem_8rem_7rem]",
  ),
  withoutImpact: cn(
    COLUMNS_BASE,
    "@[52rem]/list:grid-cols-[minmax(0,1fr)_13rem_9rem_7rem]",
  ),
} as const;

const columns = (impact: boolean) =>
  impact ? COLUMNS.withImpact : COLUMNS.withoutImpact;

/** "ends in 2h 10m" for a silence that is muting, "starts in 4h" for one that
 *  will; a closed one just says which way it closed. */
function stateText(row: AlertSilenceRecord, now: number): string {
  if (row.state === "active")
    return `ends in ${formatElapsed(new Date(row.endsAt).getTime() - now)}`;
  if (row.state === "scheduled")
    return `starts in ${formatElapsed(new Date(row.startsAt).getTime() - now)}`;
  return STATE_META[row.state].label;
}

function Row({
  row,
  now,
  pending,
  ruleName,
  impact,
  focused,
  onFocused,
  onCancel,
  onSilenceAgain,
}: {
  row: AlertSilenceRecord;
  now: number;
  pending: boolean;
  /** The rule's display name, where the rules read has arrived and knows it.
   *  Falls back to the path, which is always true if not always familiar. */
  ruleName: (path: string) => string;
  /** Whether the list is drawing an impact column at all. */
  impact: boolean;
  /** This row was just cancelled and has moved down past the divider. It takes
   *  focus, because the button that had it was unmounted by the move. */
  focused: boolean;
  onFocused: (id: string | null) => void;
  onCancel: (target: SilenceCancelTarget) => void;
  onSilenceAgain: (seed: SilenceSeed) => void;
}) {
  const open = isOpen(row.state);
  const meta = STATE_META[row.state];
  const action = useRef<HTMLButtonElement>(null);
  // The row the cancel moved is where the reader's attention already is, so
  // that is where focus goes: not the top of the document, which is where an
  // unmounted button leaves it.
  //
  // Both guards are load-bearing. `open` holds the claim until the row has
  // actually moved: until the refetch lands it is still above the divider, and
  // focusing there would spend the claim on the very button the move is about
  // to unmount. `pending` holds it until the write settles, because the row
  // remounts while every control is still disabled and focusing a disabled
  // button does nothing at all.
  useEffect(() => {
    if (!focused || open || pending) return;
    action.current?.focus();
    onFocused(null);
  }, [focused, open, pending, onFocused]);
  // Who made it, then why. The author leads: on a page that spans every rule,
  // most rows were written by somebody else, and a comment long enough to
  // truncate would otherwise take the name off the row with it. Both are typed
  // by a person and both are set in the row's sans; what the system derived
  // stays mono.
  const attribution = [row.author, row.comment].filter(Boolean).join(" · ");
  // What names this row out loud. Every button on the page reads the same two
  // words, so the label has to carry the silence it belongs to. Derived in
  // `silence-state` so this screen and the detail panel say the same thing.
  const spoken = spokenSilence(row, ruleName);
  return (
    <li
      className={cn(
        columns(impact),
        "border-t px-3 py-2.5 text-sm",
        !open && "text-muted-foreground",
        // Reinforces the group heading above, rather than standing in for it:
        // two pixels of colour cannot carry a group on its own, which is what
        // it was being asked to do while the open rows had no heading. `pl`
        // gives back what the border took, so the open rows keep the same left
        // text edge as the closed ones.
        open && "border-l-2 border-l-chart-2 pl-[0.625rem]",
      )}
    >
      {/* The rule leads, by the name the rest of the product calls it. A
          silence stores a path, and a page that printed the path made the
          reader translate `demo/demo-always-firing` into "Always firing
          (demo)" against the screen they came from. It is a link because the
          question after "what is muted" is always "show me that rule", and
          this was the one page in the product that could not answer it.

          It opens the rule here rather than on triage. "Why did nobody get
          paged" is asked while reading this list, and answering it by
          replacing the list with another screen loses the rows the reader was
          comparing. A link rather than a button because the panel is
          addressable on this route, so it still opens in a new tab and still
          copies as a URL.

          A silence naming no single rule keeps its matchers as the lead: there
          is nothing else to call it. */}
      <div className="min-w-0">
        {row.rule ? (
          <Link
            to="/alerts/silences"
            search={(prev) => ({ ...prev, alert: row.rule ?? undefined })}
            replace
            title={row.rule}
            className={cn(ROW_TARGET, "block text-sm font-medium")}
          >
            {ruleName(row.rule)}
          </Link>
        ) : (
          row.matchers && (
            <div className="truncate font-mono text-xs">{row.matchers}</div>
          )
        )}
        {/* What narrows the silence within its rule. Empty means the whole
            rule, which the row says by having nothing here. */}
        {row.rule && row.scope && (
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {row.scope}
          </div>
        )}
        {attribution && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {attribution}
          </p>
        )}
      </div>
      {/* Second in the markup so it lands beside the rule on a narrow list,
          last in the table once there are columns to be last of. */}
      <div className="justify-self-end @[52rem]/list:order-last">
        <SilenceRowAction
          ref={action}
          record={row}
          spoken={spoken}
          ruleName={ruleName}
          seedRule={null}
          pending={pending}
          className="-my-1"
          onCancel={onCancel}
          onSilence={onSilenceAgain}
        />
      </div>
      {/* One wrapped line under the rule while the list is narrow; the table's
          own columns once it is not. `contents` is what lets the same elements
          be both without being written twice. */}
      <div className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-3 @[52rem]/list:contents">
        <SilenceWindow record={row} className="truncate" />
        {/* A dot on the rows that are still open, where it separates active
            from scheduled: two states the accent alone cannot tell apart. */}
        <span className="flex items-baseline gap-1.5 font-mono text-xs tabular-nums">
          {open && (
            <span
              className={cn(
                "size-1.5 shrink-0 translate-y-[-1px] rounded-full",
                meta.dot,
              )}
            />
          )}
          {stateText(row, now)}
        </span>
        {/* Nothing stands in for an impact of nothing: the column is read for
            the few rows where something was withheld, and a dash on every
            other row is what buries them. The column itself is only drawn when
            some row has one. */}
        {impact && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {row.impact}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * The band that names a group and counts it.
 *
 * Both groups get one, and they are built the same, because the seam between
 * them is the page's one structural claim: these are muting, those are over.
 * A group marked only by a two-pixel rule on its rows was invisible at a
 * glance, which is the only distance this page is read from.
 *
 * Sticky at the top, and each inside its own wrapper, so a group's name stays
 * on screen for exactly as long as its rows do and the next one takes over
 * rather than piling on top.
 *
 * The band can carry a control at its right end. The page's one control, the
 * way to write a silence, sits on the Active band: over the buttons that end
 * silences, and at the head of the group a new silence would join.
 */
function GroupHeading({
  id,
  label,
  count,
  hint,
  action,
}: {
  id: string;
  label: string;
  count?: string;
  /** Only for what the reader cannot see from the rows. */
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    // The opaque layer is the sticky one: the band's own tint is translucent,
    // and translucent over scrolling rows smears them.
    <div className="sticky top-0 z-10 bg-background">
      {/* `px-3` on the same edge the rows use, so the headings and the rows
          all start on one left edge. `h-9` on both bands, so the one without
          a control stands as tall as the one with. */}
      <div className="flex h-9 items-center justify-between gap-3 bg-muted/20 px-3">
        <h2 id={id} className="flex items-baseline gap-2">
          <span className={COLUMN_LABEL}>{label}</span>
          {count && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{hint}</span>
        </h2>
        {action}
      </div>
    </div>
  );
}

/** Sized to a real two-line row, so the list does not resettle under the
 *  reader when the rows it was standing in for arrive. */
function LoadingRows() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading silences</span>
      <div aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="border-t px-3 py-2.5">
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * "What is muting right now", as one list rather than two sections.
 *
 * The page is ordered by consequence: the silences still muting lead, behind
 * an accent rule, and the divider marks where evidence begins. Sections were
 * tried and dropped. Two headed groups over one column grid read as a single
 * table with a stray subhead in it. One grid, one scan; position carries the
 * rest.
 *
 * The list is the control surface at the top and evidence below it, and the
 * time range bounds only the second, which the divider says and the rows above
 * it do not have to.
 *
 * No page header: the shell's breadcrumb already names the screen, so the
 * list's own heading is the document's h1 and the one action sits on the
 * Active band.
 */
export function SilencesPage({
  silences,
  ruleNames,
  pending,
  onNew,
  onCancel,
  onSilenceAgain,
}: {
  /** `null` while loading. */
  silences: AlertSilenceRecord[] | null;
  /** Rule path to display name. Empty while the rules read is in flight, which
   *  the row survives by falling back to the path. */
  ruleNames: Map<string, string>;
  /** A silence write is in flight; every silence control goes inert. */
  pending: boolean;
  onNew: () => void;
  /** `onFailed` runs when the write is refused, so a claim staked on the row
   *  moving is given back rather than left armed. */
  onCancel: (target: SilenceCancelTarget, onFailed?: () => void) => void;
  onSilenceAgain: (seed: SilenceSeed) => void;
}) {
  // One reading of the clock per render, so two rows cannot disagree about
  // what "in 4m" is measured from.
  const now = Date.now();
  // Which row should take focus when it next mounts. Owned here because this
  // is the component that knows a cancel moves a row across the divider, and
  // the only one that can tell it has: the route has no reason to know the
  // list is grouped at all. The setter is stable, so the row's effect does not
  // re-run on every render of the page.
  const [focusSilenceId, setFocusSilenceId] = useState<string | null>(null);
  const loading = silences === null;
  const rows = silences ?? [];
  // A claim no row can honour is given back. The row it names is normally the
  // one that just moved down the list, but a cancel can also take it out of
  // the read: the range bounds the closed rows, so cancelling an active
  // silence while the reader is looking at last week drops it entirely. Kept,
  // the claim would sit armed until that row happened to be listed again and
  // then pull focus out of wherever the reader had it.
  //
  // Released in render rather than from an effect: React restarts the render
  // at once, so the list never commits with a claim it cannot spend.
  if (
    focusSilenceId !== null &&
    silences !== null &&
    !silences.some((r) => r.id === focusSilenceId)
  ) {
    setFocusSilenceId(null);
  }
  // Every silence this app writes starts at `now`, so `scheduled` has no way
  // to exist. Open rows lead the list whichever they are; should scheduling
  // ever ship, an unstarted row still lands above the divider and still says
  // "starts in 4h" rather than falling out of the page.
  const open = rows.filter((row) => isOpen(row.state));
  const closed = rows.filter((row) => !isOpen(row.state));
  const ruleName = (path: string) => ruleNames.get(path) ?? path;
  // One grid serves the whole list, so one row anywhere with an impact is
  // what earns the column.
  const impact = rows.some((row) => row.impact);
  // The read stops at its cap, so the count stops being a total. Saying `200+`
  // is the difference between a bounded answer and a wrong one.
  //
  // The cap is on the read, which returns both groups, so it is `rows` that
  // reaches it. Only then is the closed count a floor rather than the answer:
  // a page of 190 open and 12 closed knows both exactly.
  const truncated = rows.length >= SILENCE_PAGE_LIMIT;
  const activeCount = open.length > 0 ? `${open.length}` : undefined;
  const historyCount = !closed.length
    ? undefined
    : truncated
      ? `${closed.length}+`
      : `${closed.length}`;

  const row = (record: AlertSilenceRecord) => (
    <Row
      key={record.id}
      row={record}
      now={now}
      pending={pending}
      ruleName={ruleName}
      impact={impact}
      focused={focusSilenceId === record.id}
      onFocused={setFocusSilenceId}
      onCancel={(target) => {
        setFocusSilenceId(target.id);
        // The claim is only good for a row that moves. A refused cancel
        // leaves the row open and where it was, holding the claim past the
        // act that made it: the row's own effect cannot release it, because
        // it releases on having moved.
        onCancel(target, () =>
          setFocusSilenceId((id) => (id === target.id ? null : id)),
        );
      }}
      onSilenceAgain={onSilenceAgain}
    />
  );

  return (
    <div className="@container/list">
      {/* The topnav breadcrumb is the visible title. This is the document's,
          so the page is not a screen of h2s under nothing, and the list itself
          does not repeat a word the shell already said. */}
      <h1 className="sr-only">Silences</h1>

      {/* Each group is its own sticky context, so its heading stays for
          exactly as long as its rows and the next one replaces it. The rule
          between them is the wrapper's, not a band's: the first band sits
          under the shell's own rule, and a rule drawn on a band would ride
          with it and double that one whenever the band is stuck. */}
      <div className="divide-y">
        <div>
          <GroupHeading
            id="silences-active"
            label="Active"
            count={activeCount}
            // The range bounds history and not this: a silence muting right now
            // is muting whatever window the reader happens to be looking at.
            hint="now"
            // Always drawn, whatever the list holds and whatever is loading: a
            // page with nothing on it is exactly when this has to be reachable.
            action={
              <Button size="sm" disabled={pending} onClick={onNew}>
                <Plus className="size-4" />
                New silence
              </Button>
            }
          />
          {loading ? (
            <LoadingRows />
          ) : open.length === 0 ? (
            <p className="border-t px-3 py-3 text-sm text-muted-foreground">
              {/* Said to the only reader who needs telling: the one who has never
                made a silence. Once the org has history, "nothing is silenced"
                is the whole fact, and the definition is a lecture to somebody
                who just cancelled one. */}
              {closed.length === 0 ? (
                <span className="block max-w-prose">
                  Nothing is silenced. A silence stops a rule's notifications
                  without stopping the rule.{" "}
                  <a
                    href="https://everr.dev/docs/guides/set-up-notifications"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Learn more
                  </a>
                </span>
              ) : (
                "Nothing is silenced."
              )}
            </p>
          ) : (
            <ul aria-labelledby="silences-active">{open.map(row)}</ul>
          )}
        </div>

        <div>
          <GroupHeading
            id="silences-history"
            label="History"
            count={historyCount}
            hint="in range"
          />
          {loading ? (
            <LoadingRows />
          ) : closed.length === 0 ? (
            <p className="border-t px-3 py-3 text-sm text-muted-foreground">
              No silence closed in the selected time range.
            </p>
          ) : (
            <ul aria-labelledby="silences-history">{closed.map(row)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}
