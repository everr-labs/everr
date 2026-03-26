import AnsiImport from "ansi-to-react";

// Handle CJS interop — Vite may double-wrap the default export
const Ansi =
  typeof AnsiImport === "function"
    ? AnsiImport
    : (AnsiImport as unknown as { default: typeof AnsiImport }).default;

import { buttonVariants } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { LogEntry } from "@/data/runs/schemas";
import { useLogSummarizer } from "@/hooks/use-log-summarizer";
import { formatTimestampTimeOfDay } from "@/lib/formatting";
import { getMarkerClass, parseLogs } from "@/lib/log-parser";
import { aggregateLogVolume } from "@/lib/log-volume";
import { LogSummaryPanel } from "./log-summary-panel";
import { LogVolumeChart } from "./log-volume-chart";

interface LogViewerProps {
  logs: LogEntry[];
  stepName?: string;
}

export function LogViewer({ logs, stepName }: LogViewerProps) {
  const { lines, groups } = useMemo(() => parseLogs(logs), [logs]);
  const volumeData = useMemo(() => aggregateLogVolume(lines), [lines]);
  const logContentRef = useRef<HTMLDivElement>(null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const { status, summary, error, reset } = useLogSummarizer();

  const handleBarClick = (firstLineIndex: number) => {
    if (logContentRef.current) {
      const lineHeight = 18;
      const scrollPosition = (firstLineIndex - 1) * lineHeight;
      logContentRef.current.scrollTo({
        top: scrollPosition,
        behavior: "smooth",
      });

      // Highlight the line briefly
      setHighlightedLine(firstLineIndex);
      setTimeout(() => setHighlightedLine(null), 1500);
    }
  };

  // Default all groups to collapsed
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.id)),
  );

  const toggleGroup = (groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(groups.map((g) => g.id)));

  if (logs.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No logs found
      </div>
    );
  }

  // Build a map of line index to group info for efficient lookup
  const lineToGroup = new Map<number, { groupId: string; depth: number }>();
  const groupDepths = new Map<string, number>();
  // Track which groups have uniform timestamps (all lines same as group header)
  const groupsWithUniformTimestamps = new Set<string>();

  // Calculate group depths and line mappings
  for (const group of groups) {
    // Find depth by counting nested groups
    let depth = 0;
    for (const other of groups) {
      if (
        other.startIndex < group.startIndex &&
        other.endIndex > group.endIndex
      ) {
        depth++;
      }
    }
    groupDepths.set(group.id, depth);

    // Mark lines as belonging to this group
    for (let i = group.startIndex + 1; i < group.endIndex; i++) {
      const existing = lineToGroup.get(i);
      // Only set if this group is more deeply nested (higher depth)
      if (!existing || depth > existing.depth) {
        lineToGroup.set(i, { groupId: group.id, depth });
      }
    }

    // Check if all lines in this group have the same rendered timestamp as the group header
    const headerTimestamp = formatTimestampTimeOfDay(
      lines[group.startIndex].timestamp,
    );
    let hasUniformTimestamps = true;
    for (let i = group.startIndex + 1; i < group.endIndex; i++) {
      if (
        !lines[i].isGroupEnd &&
        formatTimestampTimeOfDay(lines[i].timestamp) !== headerTimestamp
      ) {
        hasUniformTimestamps = false;
        break;
      }
    }
    if (hasUniformTimestamps) {
      groupsWithUniformTimestamps.add(group.id);
    }
  }

  // Determine which lines to show based on collapsed state
  const visibleLines: {
    index: number;
    indentLevel: number;
  }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Find the innermost group this line belongs to
    const groupInfo = lineToGroup.get(i);

    // Check if any parent group is collapsed
    let isHidden = false;
    if (groupInfo) {
      // Check all groups that contain this line
      for (const group of groups) {
        if (
          i > group.startIndex &&
          i < group.endIndex &&
          collapsed.has(group.id)
        ) {
          isHidden = true;
          break;
        }
      }
    }

    // Skip endgroup markers entirely
    if (line.isGroupEnd) {
      continue;
    }

    if (!isHidden) {
      // Calculate indent level based on how many groups contain this line
      let indentLevel = 0;
      for (const group of groups) {
        if (i > group.startIndex && i <= group.endIndex) {
          indentLevel++;
        }
      }
      visibleLines.push({ index: i, indentLevel });
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Log volume chart */}
      {volumeData.length > 0 && (
        <div className="border-b px-2">
          <LogVolumeChart data={volumeData} onBarClick={handleBarClick} />
        </div>
      )}

      {/* Header with expand/collapse buttons */}
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        {stepName && <span className="text-xs font-medium">{stepName}</span>}
        {!stepName && <span />}
        <div className="flex gap-1">
          {groups.length > 0 && (
            <>
              <button
                type="button"
                onClick={expandAll}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "h-6 gap-1 px-2 text-xs",
                )}
              >
                <ChevronsUpDown className="size-3" />
                Expand
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "h-6 gap-1 px-2 text-xs",
                )}
              >
                <ChevronsDownUp className="size-3" />
                Collapse
              </button>
            </>
          )}
        </div>
      </div>

      {/* AI Summary panel */}
      {status !== "idle" && (
        <LogSummaryPanel
          status={status}
          summary={summary}
          error={error}
          onClose={reset}
        />
      )}

      {/* Log content with groups */}
      <div
        ref={logContentRef}
        className="bg-muted/50 flex-1 overflow-auto font-mono text-xs"
      >
        {visibleLines.map(({ index, indentLevel }) => {
          const line = lines[index];
          const hasGroups = groups.length > 0;
          const lineNumber = index + 1;

          // Find group info for this line if it's a group start
          const group = line.isGroupStart
            ? groups.find((g) => g.startIndex === index)
            : null;

          if (line.isGroupStart && group) {
            const isCollapsed = collapsed.has(group.id);
            return (
              <button
                type="button"
                key={index}
                className={cn(
                  "grid w-full items-center px-1 py-px text-left",
                  "hover:bg-muted cursor-pointer",
                  highlightedLine === index && "animate-highlight-fade",
                )}
                style={{
                  gridTemplateColumns: `40px ${indentLevel * 16}px 16px 1fr auto`,
                }}
                onClick={() => toggleGroup(group.id)}
              >
                <span className="text-muted-foreground select-none pr-2 text-right">
                  {lineNumber}
                </span>
                <span />
                <ChevronRight
                  className={cn(
                    "size-3 shrink-0 transition-transform",
                    !isCollapsed && "rotate-90",
                  )}
                />

                <Ansi useClasses linkify>
                  {line.body}
                </Ansi>

                <span className="text-muted-foreground select-none pl-2">
                  {formatTimestampTimeOfDay(line.timestamp)}
                </span>
              </button>
            );
          }

          // When groups exist, use grid layout to align with chevron column
          if (hasGroups) {
            // Check if this line is inside a group with uniform timestamps
            const groupInfo = lineToGroup.get(index);
            const hideTimestamp =
              groupInfo && groupsWithUniformTimestamps.has(groupInfo.groupId);

            return (
              <div
                key={index}
                className={cn(
                  "grid whitespace-pre-wrap px-1 py-px",
                  "hover:bg-muted",
                  getMarkerClass(line.markerType),
                  highlightedLine === index && "animate-highlight-fade",
                )}
                style={{
                  gridTemplateColumns: `40px ${indentLevel * 16}px 16px 1fr auto`,
                }}
              >
                <span className="text-muted-foreground select-none pr-2 text-right">
                  {lineNumber}
                </span>
                <span />
                <span />
                <Ansi useClasses linkify>
                  {line.body}
                </Ansi>

                {hideTimestamp ? (
                  <span />
                ) : (
                  <span className="text-muted-foreground select-none pl-2">
                    {formatTimestampTimeOfDay(line.timestamp)}
                  </span>
                )}
              </div>
            );
          }

          // Without groups, use simpler layout with grid
          return (
            <div
              key={index}
              className={cn(
                "grid whitespace-pre-wrap px-1 py-px",
                "hover:bg-muted",
                getMarkerClass(line.markerType),
                highlightedLine === index &&
                  "animate-highlight-fade bg-yellow-500/30",
              )}
              style={{
                gridTemplateColumns: `40px 1fr auto`,
                paddingLeft: `${indentLevel * 16}px`,
              }}
            >
              <span className="text-muted-foreground select-none pr-2 text-right">
                {lineNumber}
              </span>
              <Ansi useClasses linkify>
                {line.body}
              </Ansi>
              <span className="text-muted-foreground select-none pl-2">
                {formatTimestampTimeOfDay(line.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
