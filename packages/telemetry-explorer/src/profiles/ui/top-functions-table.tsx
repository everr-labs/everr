/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The header must sit outside the scrolling rows, which a native table cannot do, so the table is built from ARIA table roles. */
import { cn } from "@everr/ui/lib/utils";
import { ArrowDown, ExternalLink, Layers } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { type FunctionDiff, formatShareDelta } from "../model/diff";
import type { FunctionStat } from "../model/flame-tree";
import type { FunctionRef } from "../model/sandwich";
import { formatPercent, formatProfileValue } from "../model/format";
import { runtimeFrameNote } from "../model/runtime-frames";
import { frameColor } from "./frame-color";

// Past a few hundred rows the tail is noise and only costs DOM nodes.
const MAX_ROWS = 200;

type SortKey = "self" | "total";

const TOP_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-center sm:grid-cols-[minmax(0,1fr)_11rem_11rem]";
const DIFF_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_6rem_6rem_5rem] items-center sm:grid-cols-[minmax(0,1fr)_11rem_11rem_7rem]";

/** Row interactions shared by both tables. */
type RowActions = {
  /** The function a row click picked: highlighted in the flamegraph, or shown in callers and callees. */
  activeKey?: string;
  /** What a click on a function's name does, for its tooltip. */
  activateHint: string;
  onActivate: (fn: FunctionRef & { key: string }) => void;
  /** Lit up while its frames are hovered in the flamegraph. */
  hoveredKey?: string;
  onHover: (key: string | undefined) => void;
  /** Absent where there is no room for the callers and callees view. */
  onShowCallers?: (fn: FunctionRef) => void;
  /** A link to the function's code, when the stacks carry the repository and revision. */
  sourceUrlOf: (key: string) => string | undefined;
};

export function TopFunctionsTable({
  stats,
  unit,
  total,
  ...actions
}: {
  stats: readonly FunctionStat[];
  unit: string;
  total: number;
} & RowActions) {
  const [sortKey, setSortKey] = useState<SortKey>("self");
  const rows = useMemo(
    () =>
      [...stats]
        .sort((a, b) => b[sortKey] - a[sortKey] || a.name.localeCompare(b.name))
        .slice(0, MAX_ROWS),
    [stats, sortKey],
  );

  return (
    <FunctionsTable
      label="Top functions"
      columns={TOP_COLUMNS}
      header={
        <>
          <ColumnHeader>Function</ColumnHeader>
          <SortHeader label="Self" sortKey="self" active={sortKey} onSort={setSortKey} />
          <SortHeader label="Total" sortKey="total" active={sortKey} onSort={setSortKey} />
        </>
      }
    >
      {rows.map((row) => (
        <div key={row.key} {...rowProps(row.key, TOP_COLUMNS, actions)}>
          <FunctionCell row={row} {...actions} />
          <ValueCell value={row.self} unit={unit} total={total} />
          <ValueCell value={row.total} unit={unit} total={total} />
        </div>
      ))}
    </FunctionsTable>
  );
}

/** Self time in both windows, biggest share change first. */
export function DiffFunctionsTable({
  rows,
  unit,
  total,
  baselineTotal,
  ...actions
}: {
  rows: readonly FunctionDiff[];
  unit: string;
  total: number;
  baselineTotal: number;
} & RowActions) {
  const sorted = useMemo(
    () =>
      [...rows]
        .sort(
          (a, b) => Math.abs(b.selfDelta) - Math.abs(a.selfDelta) || a.name.localeCompare(b.name),
        )
        .slice(0, MAX_ROWS),
    [rows],
  );
  return (
    <FunctionsTable
      label="Functions by change in self time"
      columns={DIFF_COLUMNS}
      header={
        <>
          <ColumnHeader>Function</ColumnHeader>
          <ColumnHeader className="text-right">Baseline self</ColumnHeader>
          <ColumnHeader className="text-right">Self</ColumnHeader>
          <ColumnHeader className="text-foreground text-right" sort="descending">
            Change
          </ColumnHeader>
        </>
      }
    >
      {sorted.map((row) => (
        <div key={row.key} {...rowProps(row.key, DIFF_COLUMNS, actions)}>
          <FunctionCell row={row} {...actions} />
          <ValueCell value={row.baselineSelf} unit={unit} total={baselineTotal} />
          <ValueCell value={row.comparisonSelf} unit={unit} total={total} />
          <div
            role="cell"
            className={cn(
              "px-3 py-1 text-right tabular-nums whitespace-nowrap pointer-coarse:py-2.5",
              row.selfDelta > 0.0001 && "text-destructive",
              row.selfDelta < -0.0001 && "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {formatShareDelta(row.selfDelta)}
          </div>
        </div>
      ))}
    </FunctionsTable>
  );
}

/**
 * The header row stays above the scrolling rows instead of sticking inside
 * them: iOS moves a sticky header a frame behind the rows during momentum
 * scrolling, so rows showed above it. Both parts reserve the scrollbar's room,
 * so their columns line up.
 */
function FunctionsTable({
  label,
  columns,
  header,
  children,
}: {
  label: string;
  columns: string;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="table" aria-label={label} className="flex min-h-0 flex-1 flex-col text-xs">
      <div role="rowgroup" className="shrink-0 overflow-hidden border-b [scrollbar-gutter:stable]">
        <div role="row" className={cn(columns, "text-muted-foreground text-left")}>
          {header}
        </div>
      </div>
      <div role="rowgroup" className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {children}
      </div>
    </div>
  );
}

function ColumnHeader({
  className,
  sort,
  children,
}: {
  className?: string;
  sort?: "descending" | "none";
  children: ReactNode;
}) {
  return (
    <div role="columnheader" aria-sort={sort} className={cn("px-3 py-1.5 font-medium", className)}>
      {children}
    </div>
  );
}

function rowProps(key: string, columns: string, { activeKey, hoveredKey, onHover }: RowActions) {
  return {
    role: "row",
    className: cn(
      columns,
      "hover:bg-muted/40 border-b border-border/50",
      key === hoveredKey && "bg-muted/40",
      key === activeKey && "bg-muted/70",
    ),
    onMouseEnter: () => onHover(key),
    onMouseLeave: () => onHover(undefined),
  };
}

function FunctionCell({
  row,
  activeKey,
  activateHint,
  onActivate,
  onShowCallers,
  sourceUrlOf,
}: { row: { key: string; name: string; file: string } } & RowActions) {
  const sourceUrl = sourceUrlOf(row.key);
  return (
    <div role="cell" className="min-w-0 px-3 py-1 font-mono pointer-coarse:py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="hover:text-foreground flex min-w-0 flex-1 items-center text-left hover:underline"
          title={[row.name, row.file, runtimeFrameNote(row.name), activateHint]
            .filter(Boolean)
            .join("\n")}
          aria-pressed={row.key === activeKey}
          onClick={() => onActivate({ key: row.key, name: row.name, file: row.file })}
        >
          <span
            aria-hidden
            className="mr-2 inline-block size-2 shrink-0 rounded-sm"
            style={{ background: frameColor(row.name) }}
          />
          <span className="truncate">{row.name}</span>
        </button>
        {onShowCallers ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground shrink-0 pointer-coarse:-m-2 pointer-coarse:p-2"
            aria-label={`Show callers and callees of ${row.name}`}
            title="Callers and callees"
            onClick={() => onShowCallers({ name: row.name, file: row.file })}
          >
            <Layers className="size-3 pointer-coarse:size-4" />
          </button>
        ) : null}
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground shrink-0 pointer-coarse:-m-2 pointer-coarse:p-2"
            aria-label={`Open source of ${row.name}`}
            title="Open source"
          >
            <ExternalLink className="size-3 pointer-coarse:size-4" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  active,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey === active;
  return (
    <ColumnHeader className="text-right" sort={isActive ? "descending" : "none"}>
      <button
        type="button"
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 pointer-coarse:py-2",
          isActive && "text-foreground",
        )}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowDown className={cn("size-3", !isActive && "opacity-0")} />
      </button>
    </ColumnHeader>
  );
}

function ValueCell({ value, unit, total }: { value: number; unit: string; total: number }) {
  return (
    <div
      role="cell"
      className="px-3 py-1 text-right tabular-nums whitespace-nowrap pointer-coarse:py-2.5"
    >
      {formatProfileValue(value, unit)}
      {/* Under the value on narrow screens, so the function names keep their room. */}
      <span className="text-muted-foreground block sm:ml-1.5 sm:inline-block sm:w-14">
        {formatPercent(value, total)}
      </span>
    </div>
  );
}
