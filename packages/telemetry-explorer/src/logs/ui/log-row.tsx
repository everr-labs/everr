import { formatRowTimestamp } from "@everr/ui/lib/timestamp";
import { cn } from "@everr/ui/lib/utils";
import AnsiImport from "ansi-to-react";
import { ChevronRight } from "lucide-react";
import { memo } from "react";
import type { LogExplorerRow } from "../schemas";
import { LOG_LEVEL_META } from "./log-level-meta";

const Ansi =
  typeof AnsiImport === "function"
    ? AnsiImport
    : // ansi-to-react ships as CJS; under some bundlers the default import resolves to
      // the module namespace ({ default: Component }) rather than the component itself.
      // oxlint-disable-next-line typescript/consistent-type-assertions -- CJS/ESM interop: the runtime default-import shape diverges from the declared component type
      (AnsiImport as unknown as { default: typeof AnsiImport }).default;

interface LogRowProps {
  log: LogExplorerRow;
  rowKey: string;
  isSelected: boolean;
  onSelect: (log: LogExplorerRow, key: string) => void;
  /** Show the day with the time: the list covers more than one day. */
  withDay: boolean;
}

function levelAccentClassName(level: LogExplorerRow["level"]) {
  return LOG_LEVEL_META[level].dotClassName;
}

export const LogRow = memo(function LogRow({
  log,
  rowKey,
  isSelected,
  onSelect,
  withDay,
}: LogRowProps) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native <button> would prevent selecting log text for copy
      role="button"
      tabIndex={0}
      className={cn(
        // Below `md` the time sits on its own line above the message, which then
        // has the full width: beside it, a time column wide enough for
        // "11:05:35 PM" would leave a phone's message a few words per line.
        "relative group grid w-full cursor-default grid-cols-1 items-start py-0.5 text-left font-mono text-[0.75rem] hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 md:py-0",
        // The time column is as wide as its longest time, counted in
        // characters: the row's font is the cells' monospace one, so a `ch`
        // is one of their characters. 19ch is "Nov 10, 12:54:11 PM", 11ch
        // "12:54:11 PM"; 0.75rem is the cell's left padding.
        withDay
          ? "md:grid-cols-[calc(19ch+0.75rem)_minmax(0,1fr)]"
          : "md:grid-cols-[calc(11ch+0.75rem)_minmax(0,1fr)]",
        isSelected && "bg-muted/70 hover:bg-muted/70",
      )}
      onClick={() => onSelect(log, rowKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(log, rowKey);
        }
      }}
    >
      <div
        className={cn(
          "self-stretch absolute left-0 top-px bottom-px w-[3px]",
          levelAccentClassName(log.level),
        )}
      />

      {/* No right padding: the message's left padding is the gap. */}
      <div className="px-3 md:py-0.5 md:pr-0">
        <span className="block select-none font-mono text-[0.75rem] leading-4 text-muted-foreground tabular-nums">
          {formatRowTimestamp(log.timestamp, withDay)}
        </span>
      </div>

      {/* The right padding keeps the message clear of the hover chevron, which
          a touch screen never shows. */}
      <div className="min-w-0 px-3 md:py-0.5 md:pr-9">
        <div className="select-text whitespace-pre-wrap break-words font-mono text-[0.75rem] leading-4 min-h-4 text-foreground">
          <Ansi useClasses>{log.body}</Ansi>
        </div>
      </div>

      <ChevronRight
        aria-hidden="true"
        className="absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100"
      />
    </div>
  );
});
