import { cn } from "@everr/ui/lib/utils";
import AnsiImport from "ansi-to-react";
import { ChevronRight } from "lucide-react";
import { memo } from "react";
import type { LogExplorerRow } from "../schemas";
import { formatTimestampTimeOfDay } from "../util/formatting";
import { LOG_LEVEL_META } from "./log-level-meta";

const Ansi =
  typeof AnsiImport === "function"
    ? AnsiImport
    : (AnsiImport as unknown as { default: typeof AnsiImport }).default;

export interface LogRowProps {
  index: number;
  log: LogExplorerRow;
  rowKey: string;
  isSelected: boolean;
  isInRange: boolean;
  onMouseDown: (index: number) => void;
  onSelect: (log: LogExplorerRow, key: string) => void;
}

function levelAccentClassName(level: LogExplorerRow["level"]) {
  return LOG_LEVEL_META[level].dotClassName;
}

export const LogRow = memo(function LogRow({
  index,
  log,
  rowKey,
  isSelected,
  isInRange,
  onMouseDown,
  onSelect,
}: LogRowProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Native buttons prevent selecting log text for copy.
    <div
      role="button"
      tabIndex={0}
      data-log-index={index}
      className={cn(
        "relative group grid w-full cursor-default grid-cols-[86px_minmax(0,1fr)] items-start text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 md:grid-cols-[112px_minmax(0,1fr)]",
        isSelected && "bg-muted/70 hover:bg-muted/70",
      )}
      onMouseDown={() => onMouseDown(index)}
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

      <div className="px-3 py-0.5">
        <span className="block select-none font-mono text-[0.75rem] leading-4 text-muted-foreground tabular-nums">
          {formatTimestampTimeOfDay(log.timestamp)}
        </span>
      </div>

      <div
        className={cn("min-w-0 px-3 pr-9 py-0.5", isInRange && "bg-primary/20")}
      >
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
