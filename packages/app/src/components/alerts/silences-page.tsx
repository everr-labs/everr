import { Button } from "@everr/ui/components/button";
import { GroupBand } from "@everr/ui/components/group-band";
import { cn } from "@everr/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "@/data/alerting/triage/format";
import type {
  AlertSilenceRecord,
  SilenceCut,
} from "@/data/alerting/triage/view";
import type { SilenceCancelTarget } from "@/hooks/use-silence-controls";
import { LoadingRows, ROW_HOVER, ROW_TARGET } from "./list-row";
import type { SilenceSeed } from "./silence-dialog";
import { SilenceRowAction, SilenceWindow } from "./silence-row";
import {
  isOpen,
  STATE_META,
  spokenSilence,
  windowBounds,
} from "./silence-state";

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
  impact,
  focused,
  onFocused,
  onCancel,
  onSilenceAgain,
}: {
  row: AlertSilenceRecord;
  now: number;
  pending: boolean;
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
  const bounds = windowBounds(row);
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
  const spoken = spokenSilence(row);
  const navigate = useNavigate();
  // One destination for the row's pointer convenience and for the name's link,
  // so a click anywhere on the row lands where the link says it goes. The link
  // stays the real control: it is what keyboard focus reaches, what opens in a
  // new tab and what copies as a URL, none of which a click handler gives.
  const openRule = row.rule
    ? () =>
        navigate({
          to: "/alerts/silences",
          search: (prev) => ({ ...prev, alert: row.rule?.path }),
          replace: true,
        })
    : undefined;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only row convenience, the link inside is the real control
    <li
      onClick={openRule}
      className={cn(
        columns(impact),
        "border-t px-3 py-2.5 text-sm",
        !open && "text-muted-foreground",
        // Only where there is a rule to open: the wash and the pointer are
        // what say a row leads somewhere, and a row that offers both and goes
        // nowhere is a promise the list does not keep.
        row.rule && cn("cursor-pointer", ROW_HOVER),
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

          A silence naming no single rule leads with whatever else names it:
          "Deleted rule" where the rule it named is gone, its scope otherwise.
          Its matchers are not the lead, because the rule matcher among them
          holds a definition's row id, and a row that spelled them out printed
          that uuid at the reader. What it must never be is empty, which is
          what a row whose rule did not resolve used to render. */}
      <div className="min-w-0">
        {row.rule ? (
          <Link
            to="/alerts/silences"
            search={(prev) => ({ ...prev, alert: row.rule?.path })}
            replace
            title={row.rule.path}
            // `text-foreground` against the row's own colour: a closed row is
            // muted as a whole, and the rule's name is the one thing on it the
            // reader scans for. Triage sets it at full strength and this is
            // the same name on the same kind of list.
            className={cn(
              ROW_TARGET,
              "block text-sm font-medium text-foreground",
            )}
          >
            {row.rule.name}
          </Link>
        ) : (
          <div className="truncate font-mono text-xs">{spoken}</div>
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops the row click when using the silence controls */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stops the row click when using the silence controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="justify-self-end @[52rem]/list:order-last"
      >
        <SilenceRowAction
          ref={action}
          record={row}
          spoken={spoken}
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
        <SilenceWindow bounds={bounds} className="truncate" />
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
  cut,
  pending,
  onNew,
  onCancel,
  onSilenceAgain,
}: {
  /** `null` while loading. Each record already carries its rule's display
   *  name, resolved by the read that fetched it. */
  silences: AlertSilenceRecord[] | null;
  /** Which group the read's cap cut short, decided by the read itself. That
   *  group's count is a floor, and its empty state cannot claim the group is
   *  empty when the cap simply never reached it. */
  cut: SilenceCut;
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
  // One grid serves the whole list, so one row anywhere with an impact is
  // what earns the column.
  const impact = rows.some((row) => row.impact);
  // The read stops at its cap, so one count stops being a total. Saying `200+`
  // is the difference between a bounded answer and a wrong one, and which
  // group it applies to is the read's answer rather than this screen's: the
  // sort order that makes it decidable is written where the cap is.
  const count = (group: AlertSilenceRecord[], atCap: boolean) =>
    group.length === 0 ? undefined : `${group.length}${atCap ? "+" : ""}`;
  const activeCount = count(open, cut === "open");
  const historyCount = count(closed, cut === "history");

  const row = (record: AlertSilenceRecord) => (
    <Row
      key={record.id}
      row={record}
      now={now}
      pending={pending}
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

      <div className="divide-y">
        <GroupBand
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
        >
          {loading ? (
            <LoadingRows count={3} label="Loading silences" />
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
        </GroupBand>

        <GroupBand
          id="silences-history"
          label="History"
          count={historyCount}
          hint="in range"
        >
          {loading ? (
            <LoadingRows count={3} label="Loading silences" />
          ) : closed.length === 0 ? (
            <p className="border-t px-3 py-3 text-sm text-muted-foreground">
              {/* The cap can fill a page with open silences alone and never
                  reach a closed one. "None closed" would then be this screen
                  asserting something the read never looked for. */}
              {cut === "open"
                ? "The list stopped at its cap before reaching closed silences."
                : "No silence closed in the selected time range."}
            </p>
          ) : (
            <ul aria-labelledby="silences-history">{closed.map(row)}</ul>
          )}
        </GroupBand>
      </div>
    </div>
  );
}
