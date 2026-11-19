import { cn } from "@everr/ui/lib/utils";
import { ArrowDown, ExternalLink, Layers } from "lucide-react";
import { useMemo, useState } from "react";
import { type FunctionDiff, formatShareDelta } from "../model/diff";
import type { FunctionStat } from "../model/flame-tree";
import type { FunctionRef } from "../model/sandwich";
import { formatPercent, formatProfileValue } from "../model/format";
import { frameColor } from "./frame-color";

// Past a few hundred rows the tail is noise and only costs DOM nodes.
const MAX_ROWS = 200;

type SortKey = "self" | "total";

/** Row interactions shared by both tables. */
type RowActions = {
  /** The function a row click picked: highlighted in the flame graph, or shown in callers and callees. */
  activeKey?: string;
  /** What a click on a function's name does, for its tooltip. */
  activateHint: string;
  onActivate: (fn: FunctionRef & { key: string }) => void;
  /** Lit up while its frames are hovered in the flame graph. */
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
    <table className="w-full table-fixed border-collapse text-xs">
      <caption className="sr-only">Top functions</caption>
      <thead className="bg-background sticky top-0 z-[1]">
        <tr className="text-muted-foreground border-b text-left">
          <th scope="col" className="px-3 py-1.5 font-medium">
            Function
          </th>
          <SortHeader label="Self" sortKey="self" active={sortKey} onSort={setSortKey} />
          <SortHeader label="Total" sortKey="total" active={sortKey} onSort={setSortKey} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} {...rowProps(row.key, actions)}>
            <FunctionCell row={row} {...actions} />
            <ValueCell value={row.self} unit={unit} total={total} />
            <ValueCell value={row.total} unit={unit} total={total} />
          </tr>
        ))}
      </tbody>
    </table>
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
    <table className="w-full table-fixed border-collapse text-xs">
      <caption className="sr-only">Functions by change in self time</caption>
      <thead className="bg-background sticky top-0 z-[1]">
        <tr className="text-muted-foreground border-b text-left">
          <th scope="col" className="px-3 py-1.5 font-medium">
            Function
          </th>
          <th scope="col" className="w-44 px-3 py-1.5 text-right font-medium">
            Baseline self
          </th>
          <th scope="col" className="w-44 px-3 py-1.5 text-right font-medium">
            Self
          </th>
          <th
            scope="col"
            aria-sort="descending"
            className="text-foreground w-28 px-3 py-1.5 text-right font-medium"
          >
            Change
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.key} {...rowProps(row.key, actions)}>
            <FunctionCell row={row} {...actions} />
            <ValueCell value={row.baselineSelf} unit={unit} total={baselineTotal} />
            <ValueCell value={row.comparisonSelf} unit={unit} total={total} />
            <td
              className={cn(
                "px-3 py-1 text-right tabular-nums whitespace-nowrap",
                row.selfDelta > 0.0001 && "text-destructive",
                row.selfDelta < -0.0001 && "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {formatShareDelta(row.selfDelta)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function rowProps(key: string, { activeKey, hoveredKey, onHover }: RowActions) {
  return {
    className: cn(
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
    <td className="px-3 py-1 font-mono">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="hover:text-foreground flex min-w-0 flex-1 items-center text-left hover:underline"
          title={`${row.file ? `${row.name}\n${row.file}` : row.name}\n${activateHint}`}
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
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label={`Show callers and callees of ${row.name}`}
            title="Callers and callees"
            onClick={() => onShowCallers({ name: row.name, file: row.file })}
          >
            <Layers className="size-3" />
          </button>
        ) : null}
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label={`Open source of ${row.name}`}
            title="Open source"
          >
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
    </td>
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
    <th
      scope="col"
      aria-sort={isActive ? "descending" : "none"}
      className="w-44 px-3 py-1.5 text-right font-medium"
    >
      <button
        type="button"
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1",
          isActive && "text-foreground",
        )}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowDown className={cn("size-3", !isActive && "opacity-0")} />
      </button>
    </th>
  );
}

function ValueCell({ value, unit, total }: { value: number; unit: string; total: number }) {
  return (
    <td className="px-3 py-1 text-right tabular-nums whitespace-nowrap">
      {formatProfileValue(value, unit)}
      <span className="text-muted-foreground ml-1.5 inline-block w-14">
        {formatPercent(value, total)}
      </span>
    </td>
  );
}
