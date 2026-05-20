import { cn } from "@everr/ui/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatDuration } from "@/lib/formatting";
import { serviceColor } from "../shared/service-color";
import { SpanBar } from "./span-bar";
import type { TimelineRow } from "./use-timeline-layout";

type Props = {
  row: TimelineRow;
  traceStartNs: bigint;
  traceEndNs: bigint;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
};

export function SpanRow({
  row,
  traceStartNs,
  traceEndNs,
  selected,
  onToggle,
  onSelect,
}: Props) {
  const { span, depth, hasChildren, collapsed } = row;
  return (
    // biome-ignore lint/a11y/useSemanticElements: nested <button> for the chevron rules out a <button> outer
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "hover:bg-muted/40 grid h-7 cursor-pointer grid-cols-[minmax(0,_2fr)_minmax(0,_3fr)] items-center border-b text-xs",
        selected && "bg-muted/60",
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div
        className="flex min-w-0 items-center gap-1.5 px-2"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle();
          }}
          className={cn(
            "text-muted-foreground flex size-4 items-center justify-center",
            !hasChildren && "invisible",
          )}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </button>
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            backgroundColor: serviceColor(
              span.serviceNamespace,
              span.serviceName,
            ),
          }}
        />
        <span className="truncate font-medium">{span.spanName}</span>
        <span className="text-muted-foreground truncate text-[10px]">
          {span.serviceName}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 pl-2 text-[10px] tabular-nums">
          {formatDuration(Number(span.duration), "ns")}
        </span>
      </div>
      <div className="relative h-full px-2">
        <SpanBar
          span={span}
          traceStartNs={traceStartNs}
          traceEndNs={traceEndNs}
        />
      </div>
    </div>
  );
}
