import AnsiImport from "ansi-to-react";

// Handle CJS interop — Vite may double-wrap the default export
const Ansi =
  typeof AnsiImport === "function"
    ? AnsiImport
    : (AnsiImport as unknown as { default: typeof AnsiImport }).default;

import { buttonVariants } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { LogEntry } from "@/data/runs/schemas";
import { formatTimestampTimeOfDay } from "@/lib/formatting";
import type { LogGroup } from "@/lib/log-parser";
import { getMarkerClass, parseLogs } from "@/lib/log-parser";

interface LogViewerProps {
  logs: LogEntry[];
  stepName?: string;
  onLoadPrevious?: () => void;
  onLoadNext?: () => void;
  isLoadingPrevious?: boolean;
  isLoadingNext?: boolean;
  /** Offset of the first log in the full dataset (for correct line numbering) */
  lineOffset?: number;
  /** Whether to scroll to the bottom on initial load (false when anchored) */
  initialScrollToBottom?: boolean;
}

function computeVisibleLines(
  lines: ReturnType<typeof parseLogs>["lines"],
  groups: LogGroup[],
  collapsed: Set<string>,
) {
  const lineToGroup = new Map<number, { groupId: string; depth: number }>();
  const groupsWithUniformTimestamps = new Set<string>();

  for (const group of groups) {
    let depth = 0;
    for (const other of groups) {
      if (
        other.startIndex < group.startIndex &&
        other.endIndex > group.endIndex
      ) {
        depth++;
      }
    }

    for (let i = group.startIndex + 1; i < group.endIndex; i++) {
      const existing = lineToGroup.get(i);
      if (!existing || depth > existing.depth) {
        lineToGroup.set(i, { groupId: group.id, depth });
      }
    }

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

  const visible: { index: number; indentLevel: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.isGroupEnd) continue;

    const groupInfo = lineToGroup.get(i);
    let isHidden = false;
    if (groupInfo) {
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

    if (!isHidden) {
      let indentLevel = 0;
      for (const group of groups) {
        if (i > group.startIndex && i <= group.endIndex) {
          indentLevel++;
        }
      }
      visible.push({ index: i, indentLevel });
    }
  }

  return { visible, lineToGroup, groupsWithUniformTimestamps };
}

export function LogViewer({
  logs,
  stepName,
  onLoadPrevious,
  onLoadNext,
  isLoadingPrevious,
  isLoadingNext,
  lineOffset = 0,
  initialScrollToBottom = true,
}: LogViewerProps) {
  const { lines, groups } = useMemo(() => parseLogs(logs), [logs]);

  const [anchoredLine, setAnchoredLine] = useState<number | null>(() => {
    const match = window.location.hash.match(/^#L(\d+)$/);
    return match ? Number(match[1]) : null;
  });

  const handleLineClick = useCallback(
    (lineNumber: number, e: React.MouseEvent) => {
      e.preventDefault();
      const hash = `#L${lineNumber}`;
      window.history.replaceState(null, "", hash);
      setAnchoredLine(lineNumber);
    },
    [],
  );

  // Default all groups to collapsed
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.id)),
  );

  const {
    visible: visibleLines,
    lineToGroup,
    groupsWithUniformTimestamps,
  } = useMemo(
    () => computeVisibleLines(lines, groups, collapsed),
    [lines, groups, collapsed],
  );

  const firstItemIndex = lineOffset;

  // Compute initial scroll target for anchor line
  const initialAnchorIndex = useMemo(() => {
    if (anchoredLine === null) return undefined;
    const logIndex = anchoredLine - 1 - lineOffset;
    const visibleIndex = visibleLines.findIndex((v) => v.index === logIndex);
    return visibleIndex >= 0 ? firstItemIndex + visibleIndex : undefined;
  }, [anchoredLine, lineOffset, visibleLines, firstItemIndex]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(
    () => setCollapsed(new Set(groups.map((g) => g.id))),
    [groups],
  );

  const renderLine = useCallback(
    (absoluteIndex: number) => {
      const entry = visibleLines[absoluteIndex - firstItemIndex];
      if (!entry) {
        return (
          <div className={cn("grid whitespace-pre-wrap px-1 py-px")}></div>
        );
      }
      const { index, indentLevel } = entry;
      const line = lines[index];
      const hasGroups = groups.length > 0;
      const lineNumber = index + 1 + lineOffset;

      const group = line.isGroupStart
        ? groups.find((g) => g.startIndex === index)
        : null;

      const isAnchored = anchoredLine === lineNumber;

      if (line.isGroupStart && group) {
        const isCollapsed = collapsed.has(group.id);
        return (
          <button
            type="button"
            className={cn(
              "grid w-full items-center px-1 py-px text-left",
              isAnchored ? "bg-yellow-500/20" : "hover:bg-muted cursor-pointer",
            )}
            style={{
              gridTemplateColumns: `40px ${indentLevel * 16}px 16px 1fr auto`,
            }}
            onClick={() => toggleGroup(group.id)}
          >
            <a
              href={`#L${lineNumber}`}
              onClick={(e) => {
                e.stopPropagation();
                handleLineClick(lineNumber, e);
              }}
              className="text-muted-foreground select-none pr-2 text-right hover:text-foreground"
            >
              {lineNumber}
            </a>
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

      if (hasGroups) {
        const groupInfo = lineToGroup.get(index);
        const hideTimestamp =
          groupInfo && groupsWithUniformTimestamps.has(groupInfo.groupId);

        return (
          <div
            className={cn(
              "grid whitespace-pre-wrap px-1 py-px",
              "hover:bg-muted",
              getMarkerClass(line.markerType),
              isAnchored && "bg-yellow-500/20",
            )}
            style={{
              gridTemplateColumns: `40px ${indentLevel * 16}px 16px 1fr auto`,
            }}
          >
            <a
              href={`#L${lineNumber}`}
              onClick={(e) => handleLineClick(lineNumber, e)}
              className="text-muted-foreground select-none pr-2 text-right hover:text-foreground"
            >
              {lineNumber}
            </a>
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

      return (
        <div
          className={cn(
            "grid whitespace-pre-wrap px-1 py-px",
            getMarkerClass(line.markerType),
            isAnchored ? "bg-yellow-500/20" : "hover:bg-muted",
          )}
          style={{
            gridTemplateColumns: `40px 1fr auto`,
            paddingLeft: `${indentLevel * 16}px`,
          }}
        >
          <a
            href={`#L${lineNumber}`}
            onClick={(e) => handleLineClick(lineNumber, e)}
            className="text-muted-foreground select-none pr-2 text-right hover:text-foreground"
          >
            {lineNumber}
          </a>
          <Ansi useClasses linkify>
            {line.body}
          </Ansi>
          <span className="text-muted-foreground select-none pl-2">
            {formatTimestampTimeOfDay(line.timestamp)}
          </span>
        </div>
      );
    },
    [
      visibleLines,
      lines,
      groups,
      collapsed,
      anchoredLine,
      lineOffset,
      firstItemIndex,
      lineToGroup,
      groupsWithUniformTimestamps,
      toggleGroup,
      handleLineClick,
    ],
  );

  if (logs.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No logs found
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
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

      {/* Virtualized log content */}
      <div className="bg-muted/50 min-h-0 flex-1 font-mono text-xs">
        <Virtuoso
          totalCount={visibleLines.length}
          firstItemIndex={firstItemIndex}
          initialTopMostItemIndex={
            initialAnchorIndex ??
            (initialScrollToBottom
              ? firstItemIndex + visibleLines.length - 1
              : firstItemIndex)
          }
          followOutput={initialScrollToBottom}
          startReached={() => {
            if (onLoadPrevious && !isLoadingPrevious) {
              onLoadPrevious();
            }
          }}
          endReached={() => {
            if (onLoadNext && !isLoadingNext) {
              onLoadNext();
            }
          }}
          itemContent={renderLine}
          components={{
            Header: isLoadingPrevious
              ? () => (
                  <div className="text-muted-foreground flex items-center justify-center gap-2 py-2 text-xs">
                    <Loader2 className="size-3 animate-spin" />
                    Loading older logs...
                  </div>
                )
              : undefined,
            Footer: isLoadingNext
              ? () => (
                  <div className="text-muted-foreground flex items-center justify-center gap-2 py-2 text-xs">
                    <Loader2 className="size-3 animate-spin" />
                    Loading newer logs...
                  </div>
                )
              : undefined,
          }}
        />
      </div>
    </div>
  );
}
