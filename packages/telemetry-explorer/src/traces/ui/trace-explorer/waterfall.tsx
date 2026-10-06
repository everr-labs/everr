// Third-party attribution and license: see the root NOTICE and rendering/LICENSE.
// SPDX-License-Identifier: MIT
// Adapted from TraceDetailsV3/TraceWaterfall/TraceWaterfallStates/Success.
// Uses Everr controls and React Virtuoso with one row driving tree and timeline.

import { Button } from "@everr/ui/components/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@everr/ui/components/resizable";
import { virtuosoScrollAreaComponents } from "@everr/ui/components/scroll-area";
import { formatDuration } from "@everr/ui/lib/formatting";
import { cn } from "@everr/ui/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type CSSProperties, type Ref, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { serviceColor } from "../shared/service-color";
import { TimeRuler, type ViewRange } from "./flamegraph";
import { spanColorGroup } from "./rendering/types";
import type { TraceNode } from "./trace-model";

export function TraceWaterfall({
  rows,
  selectedSpanId,
  openNodes,
  matchingIds,
  filterActive,
  colorBy,
  previewField,
  range,
  onToggle,
  onSelect,
  virtuosoRef,
}: {
  rows: TraceNode[];
  selectedSpanId?: string;
  openNodes: Set<string>;
  matchingIds: ReadonlySet<string>;
  filterActive: boolean;
  colorBy: string;
  previewField: string;
  range: ViewRange;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  virtuosoRef?: Ref<VirtuosoHandle>;
}) {
  const [labelWidth, setLabelWidth] = useState<number>();
  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      style={
        {
          "--waterfall-label-width":
            labelWidth === undefined ? "38%" : `${labelWidth}px`,
        } as CSSProperties
      }
    >
      {/* Keep one virtualized list so resizing cannot desynchronize the rows. */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="pointer-events-none absolute inset-0 z-10"
      >
        <ResizablePanel
          defaultSize="38%"
          minSize="220px"
          maxSize="70%"
          onResize={({ inPixels }) => setLabelWidth(inPixels)}
        />
        <ResizableHandle
          withHandle
          aria-label="Resize waterfall name column"
          className="pointer-events-auto"
        />
        <ResizablePanel minSize="160px" />
      </ResizablePanelGroup>
      <div className="grid shrink-0 grid-cols-[var(--waterfall-label-width)_1px_minmax(0,1fr)] border-b">
        <div className="text-muted-foreground px-3 pt-1.5 text-[10px]">
          Service / operation
        </div>
        <TimeRuler range={range} className="col-start-3 border-b-0" />
      </div>
      <Virtuoso
        ref={virtuosoRef}
        className="min-h-0 flex-1"
        data={rows}
        components={virtuosoScrollAreaComponents}
        fixedItemHeight={36}
        initialTopMostItemIndex={Math.max(
          0,
          rows.findIndex((row) => row.spanId === selectedSpanId),
        )}
        computeItemKey={(_, row) => row.spanId}
        itemContent={(_, node) => {
          const selected = selectedSpanId === node.spanId;
          const dimmed =
            filterActive && !matchingIds.has(node.spanId) && !selected;
          const color = serviceColor(spanColorGroup(node, colorBy));
          const fullWidth = range.end - range.start;
          const left = ((node.timestamp - range.start) / fullWidth) * 100;
          const right =
            ((node.timestamp + node.durationNano / 1e6 - range.start) /
              fullWidth) *
            100;
          const preview = previewField
            ? (node.attributes[previewField] ?? node.resource[previewField])
            : undefined;
          const status =
            node.attributes["http.response.status_code"] ??
            node.attributes["http.status_code"];
          return (
            <div
              data-span-id={node.spanId}
              className={cn(
                "grid h-9 grid-cols-[var(--waterfall-label-width)_1px_minmax(0,1fr)] border-b border-border/40 hover:bg-muted/40",
                selected && "bg-accent",
                dimmed && "opacity-35",
              )}
            >
              <div
                className="flex min-w-0 items-center gap-1 overflow-hidden pr-2"
                style={{ paddingLeft: Math.min(node.level * 12, 120) + 4 }}
              >
                {node.hasChildren ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${openNodes.has(node.spanId) ? "Collapse" : "Expand"} ${node.name}`}
                    onClick={() => onToggle(node.spanId)}
                  >
                    {openNodes.has(node.spanId) ? (
                      <ChevronDown />
                    ) : (
                      <ChevronRight />
                    )}
                  </Button>
                ) : (
                  <span className="w-5 shrink-0" />
                )}
                <span
                  className="size-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={`Select ${node.name}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(node.spanId)}
                  title={`${node.source.serviceName}: ${node.name}`}
                >
                  <span className="text-muted-foreground mr-2">
                    {node.source.serviceName}
                  </span>
                  {node.name}
                </button>
                {status && (
                  <span
                    className={cn(
                      "shrink-0 rounded border px-1 font-mono text-[10px]",
                      Number(status) >= 400
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {status}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="relative col-start-3 min-w-0 overflow-hidden text-left focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => onSelect(node.spanId)}
                aria-label={`Select timeline for ${node.name}`}
                aria-pressed={selected}
                title={`${node.name}: ${formatDuration(node.durationNano, "ns")}`}
              >
                {[25, 50, 75].map((tick) => (
                  <span
                    key={tick}
                    className="absolute inset-y-0 border-l border-border/40"
                    style={{ left: `${tick}%` }}
                  />
                ))}
                {right >= 0 && left <= 100 && (
                  <span
                    className={cn(
                      "absolute top-2 flex h-5 min-w-px items-center gap-2 overflow-hidden rounded-sm px-1.5 text-[10px] text-white",
                      selected && "outline-2 outline-offset-1 outline-ring",
                      node.hasError && "ring-1 ring-destructive",
                    )}
                    style={{
                      left: `${Math.max(0, left)}%`,
                      width: `${Math.min(100, right) - Math.max(0, left)}%`,
                      backgroundColor: color,
                    }}
                  >
                    {node.hasError && (
                      <span className="absolute inset-0 bg-destructive/30" />
                    )}
                    <span className="relative shrink-0 font-mono">
                      {formatDuration(node.durationNano, "ns")}
                    </span>
                    {preview && <span className="truncate">{preview}</span>}
                  </span>
                )}
                {node.event.map((event, i) => {
                  const position =
                    ((event.offsetNs / 1e6 - range.start) / fullWidth) * 100;
                  return position >= 0 && position <= 100 ? (
                    <span
                      key={`${event.offsetNs}-${i}`}
                      title={event.name}
                      className="absolute top-3.5 size-1.5 rotate-45 border border-background"
                      style={{
                        left: `${position}%`,
                        backgroundColor: event.isError
                          ? "var(--destructive)"
                          : "var(--foreground)",
                      }}
                    />
                  ) : null;
                })}
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}
