import type { LogEntry } from "@/data/runs/schemas";
import { formatTimestampTimeOfDay } from "@/lib/formatting";

export interface ParsedLogLine {
  timestamp: string;
  body: string;
  isGroupStart?: string; // Group name if this starts a group
  isGroupEnd?: boolean;
  markerType?: MarkerType; // For styling error/warning/notice/debug lines
}

export interface LogGroup {
  id: string;
  name: string;
  startIndex: number;
  endIndex: number;
}

// Parse GitHub workflow command markers
const MARKER_REGEX = /^##\[(group|endgroup|error|warning|notice|debug)\](.*)$/;
const COMMAND_REGEX = /^\[command\](.*)$/;

export type MarkerType =
  | "group"
  | "endgroup"
  | "error"
  | "warning"
  | "notice"
  | "debug"
  | "command";

export function parseGitHubMarker(
  line: string,
): { type: MarkerType; message?: string } | null {
  const match = line.match(MARKER_REGEX);
  if (match) {
    return { type: match[1] as MarkerType, message: match[2] || undefined };
  }

  const commandMatch = line.match(COMMAND_REGEX);
  if (commandMatch) {
    return { type: "command", message: commandMatch[1] || undefined };
  }

  return null;
}

// Styling classes for markers
export function getMarkerClass(type: MarkerType | undefined): string {
  switch (type) {
    case "error":
      return "bg-red-500/10 text-red-400";
    case "warning":
      return "bg-yellow-500/10 text-yellow-400";
    case "notice":
      return "bg-blue-500/10 text-blue-400";
    case "command":
      return "text-cyan-400";
    case "debug":
      return "text-muted-foreground/60";
    default:
      return "";
  }
}

export function parseLogs(logs: LogEntry[]): {
  lines: ParsedLogLine[];
  groups: LogGroup[];
} {
  const lines: ParsedLogLine[] = [];
  const groups: LogGroup[] = [];
  const groupStack: { id: string; name: string; startIndex: number }[] = [];
  let groupId = 0;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const marker = parseGitHubMarker(log.body);

    if (marker?.type === "group") {
      const id = `group-${groupId++}`;
      groupStack.push({ id, name: marker.message || "Group", startIndex: i });
      lines.push({
        timestamp: log.timestamp,
        body: marker.message || "Group",
        isGroupStart: marker.message || "Group",
      });
    } else if (marker?.type === "endgroup") {
      const group = groupStack.pop();
      if (group) {
        groups.push({ ...group, endIndex: i });
      }
      lines.push({
        timestamp: log.timestamp,
        body: log.body,
        isGroupEnd: true,
      });
    } else if (marker) {
      // error, warning, notice, debug markers
      lines.push({
        timestamp: log.timestamp,
        body: log.body,
        markerType: marker.type,
      });
    } else {
      lines.push({
        timestamp: log.timestamp,
        body: log.body,
      });
    }
  }

  // Handle unclosed groups
  while (groupStack.length > 0) {
    const group = groupStack.pop();
    if (group) {
      groups.push({ ...group, endIndex: logs.length - 1 });
    }
  }

  return { lines, groups };
}

interface VisibleLine {
  index: number;
  indentLevel: number;
  displayLine: number;
}

function computeGroupDepth(group: LogGroup, groups: LogGroup[]): number {
  let depth = 0;
  for (const other of groups) {
    if (
      other.startIndex < group.startIndex &&
      other.endIndex > group.endIndex
    ) {
      depth++;
    }
  }
  return depth;
}

function hasUniformTimestamps(
  lines: ParsedLogLine[],
  group: LogGroup,
): boolean {
  const headerTimestamp = formatTimestampTimeOfDay(
    lines[group.startIndex].timestamp,
  );
  for (let i = group.startIndex + 1; i < group.endIndex; i++) {
    if (
      !lines[i].isGroupEnd &&
      formatTimestampTimeOfDay(lines[i].timestamp) !== headerTimestamp
    ) {
      return false;
    }
  }
  return true;
}

function buildGroupMetadata(lines: ParsedLogLine[], groups: LogGroup[]) {
  const lineToGroup = new Map<number, { groupId: string; depth: number }>();
  const groupsWithUniformTimestamps = new Set<string>();

  for (const group of groups) {
    const depth = computeGroupDepth(group, groups);

    for (let i = group.startIndex + 1; i < group.endIndex; i++) {
      const existing = lineToGroup.get(i);
      if (!existing || depth > existing.depth) {
        lineToGroup.set(i, { groupId: group.id, depth });
      }
    }

    if (hasUniformTimestamps(lines, group)) {
      groupsWithUniformTimestamps.add(group.id);
    }
  }

  return { lineToGroup, groupsWithUniformTimestamps };
}

function isHiddenByCollapse(
  index: number,
  groups: LogGroup[],
  collapsed: Set<string>,
): boolean {
  for (const group of groups) {
    if (
      index > group.startIndex &&
      index < group.endIndex &&
      collapsed.has(group.id)
    ) {
      return true;
    }
  }
  return false;
}

function computeIndentLevel(index: number, groups: LogGroup[]): number {
  let indentLevel = 0;
  for (const group of groups) {
    if (index > group.startIndex && index <= group.endIndex) {
      indentLevel++;
    }
  }
  return indentLevel;
}

export function computeVisibleLines(
  lines: ParsedLogLine[],
  groups: LogGroup[],
  collapsed: Set<string>,
) {
  const { lineToGroup, groupsWithUniformTimestamps } = buildGroupMetadata(
    lines,
    groups,
  );

  const visible: VisibleLine[] = [];
  let displayLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].isGroupEnd) continue;
    displayLine++;

    if (lineToGroup.get(i) && isHiddenByCollapse(i, groups, collapsed)) {
      continue;
    }

    visible.push({
      index: i,
      indentLevel: computeIndentLevel(i, groups),
      displayLine,
    });
  }

  return { visible, lineToGroup, groupsWithUniformTimestamps };
}
