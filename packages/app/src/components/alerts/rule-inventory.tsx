import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import type {
  RuleInventoryRow,
  RuleStateHistory,
  RuleStateHistoryData,
} from "@/data/alerting/triage/view";
import { SeverityLabel, StatusIcon } from "./alert-status";
import { COLUMN_LABEL } from "./list-columns";
import { RowTarget, SelectableRow } from "./list-row";
import {
  RuleStateChart,
  StateChartAxis,
  StateChartLegend,
} from "./rule-state-chart";

/** Shared empties: a fresh `[]` per rule per render would defeat the memo on
 *  `RuleStateChart`, which every row of a long inventory carries. */
const NO_SEGMENTS: RuleStateHistory["segments"] = [];
const NO_INSTANCES: RuleStateHistory["instances"] = [];

// Sized against the list column, not the window: the detail panel takes its
// width from this list, and a viewport breakpoint cannot see that happen.
// The state chart is the column worth keeping longest, so the middle tier
// keeps a shorter one and drops the two values a reader can get from the
// detail panel instead.
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-4 @[44rem]/list:grid-cols-[minmax(0,1fr)_12rem_6rem] @[50rem]/list:grid-cols-[minmax(0,1fr)_16rem_5rem_4rem_6rem]";

/**
 * Every rule in the org, quiet ones included, under the triage list on the
 * same page. Triage answers "what needs me now"; this answers "is anything
 * watching this at all", which is the question a responder asks about the
 * thing that is *not* in the list above.
 */
// The gutter belongs to the rows, not to the section around them: a selected
// row has to fill the list column edge to edge, and a section that held the
// padding left its highlight floating 12px short of both sides. Same division
// the triage rows above make.
export function RuleInventory({
  rules,
  history,
  openPath,
  onOpen,
}: {
  rules: RuleInventoryRow[];
  /** States and instance values per rule, over the window the server read
   *  them for. `undefined` until that query answers: the chart column, axis
   *  included, stands in with skeletons, because the axis is measured
   *  against the same window as the tracks and has nothing to say before
   *  the response names it. */
  history: RuleStateHistoryData | undefined;
  openPath: string | null;
  onOpen: (path: string) => void;
}) {
  return (
    <section className="pb-6">
      {/* The legend leads the only charts left on the page: the reader meets
          the colours before the first row, not after the last. It hides with
          the column it explains, which a narrow list column does not render
          at all. */}
      <div className="hidden px-3 pb-2.5 @[44rem]/list:block">
        <StateChartLegend />
      </div>

      {/* One header row, not three. The section's own title is the Rule
          column's label, and the axis is the state column's: both name their
          column exactly, so a separate heading and a separate axis strip were
          two rows of vertical space spent saying it twice. */}
      <div className={cn(COLUMNS, "px-3 pb-1.5")}>
        <h2 className="text-sm font-medium">All rules</h2>
        <div className="hidden @[44rem]/list:block">
          {history ? (
            <StateChartAxis windowMinutes={history.window.minutes} />
          ) : (
            <Skeleton className="h-3 w-full rounded-sm" />
          )}
        </div>
        <span className={cn(COLUMN_LABEL, "hidden @[50rem]/list:block")}>
          Severity
        </span>
        <span className={cn(COLUMN_LABEL, "hidden @[50rem]/list:block")}>
          Every
        </span>
        <span className={cn(COLUMN_LABEL, "text-right")}>Silence</span>
      </div>

      {rules.map((row) => (
        <SelectableRow
          key={row.path}
          selected={openPath === row.path}
          onOpen={() => onOpen(row.path)}
          className={cn(COLUMNS, "border-t px-3 py-2.5 text-sm")}
        >
          <div className="flex min-w-0 items-center gap-2">
            <StatusIcon status={row.state} className="size-3.5" />
            {/* The same panel the triage rows open, at the same URL. A rule
                has one detail view, whichever list you reached it from. */}
            <RowTarget title={row.path}>{row.name}</RowTarget>
          </div>
          <div className="hidden @[44rem]/list:block">
            {history ? (
              <RuleStateChart
                segments={history.rules[row.path]?.segments ?? NO_SEGMENTS}
                instances={history.rules[row.path]?.instances ?? NO_INSTANCES}
                window={history.window}
                name={row.name}
              />
            ) : (
              <Skeleton className="h-3.5 w-full rounded-sm" />
            )}
          </div>
          <SeverityLabel
            severity={row.severity}
            className="hidden @[50rem]/list:inline-flex"
          />
          <span className="hidden font-mono text-xs text-muted-foreground tabular-nums @[50rem]/list:block">
            {row.every}
          </span>
          <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
            {row.silence}
          </span>
        </SelectableRow>
      ))}
    </section>
  );
}
