import type { LogEntry } from "@/data/runs/schemas";

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
export const MARKER_REGEX =
  /^##\[(group|endgroup|error|warning|notice|debug)\](.*)$/;
export const COMMAND_REGEX = /^\[command\](.*)$/;

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
      return "bg-red-500/10 text-red-600 dark:text-red-400";
    case "warning":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
    case "notice":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    case "command":
      return "text-cyan-600 dark:text-cyan-400";
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
