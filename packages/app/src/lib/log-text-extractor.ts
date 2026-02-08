import type { LogEntry } from "@/data/runs";
import { COMMAND_REGEX, MARKER_REGEX } from "./log-parser";

// ANSI escape codes
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences requires the ESC control character
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Extract clean plain text from log entries for summarization.
 * Strips GitHub workflow markers, ANSI escape codes, and empty lines.
 */
export function extractLogText(logs: LogEntry[]): string {
  const lines: string[] = [];

  for (const log of logs) {
    let line = log.body;

    // Strip GitHub workflow markers, keeping the message portion
    const markerMatch = line.match(MARKER_REGEX);
    if (markerMatch) {
      // Skip group/endgroup markers entirely
      if (markerMatch[1] === "group" || markerMatch[1] === "endgroup") {
        continue;
      }
      // For error/warning/notice/debug, keep the message after the marker
      line = line.replace(MARKER_REGEX, "").trim();
    }

    const commandMatch = line.match(COMMAND_REGEX);
    if (commandMatch) {
      line = line.replace(COMMAND_REGEX, "").trim();
    }

    // Strip ANSI escape codes
    line = line.replace(ANSI_REGEX, "");

    // Skip empty lines
    if (line.trim() === "") {
      continue;
    }

    lines.push(line);
  }

  return lines.join("\n");
}
