import { describe, expect, it } from "vitest";
import type { LogEntry } from "@/data/runs/schemas";
import {
  computeVisibleLines,
  getMarkerClass,
  parseGitHubMarker,
  parseLogs,
} from "./log-parser";

describe("parseGitHubMarker", () => {
  it("parses group markers", () => {
    expect(parseGitHubMarker("##[group]Run tests")).toEqual({
      type: "group",
      message: "Run tests",
    });
  });

  it("parses endgroup markers", () => {
    expect(parseGitHubMarker("##[endgroup]")).toEqual({
      type: "endgroup",
      message: undefined,
    });
  });

  it("parses error markers", () => {
    expect(parseGitHubMarker("##[error]Something failed")).toEqual({
      type: "error",
      message: "Something failed",
    });
  });

  it("parses warning markers", () => {
    expect(parseGitHubMarker("##[warning]Watch out")).toEqual({
      type: "warning",
      message: "Watch out",
    });
  });

  it("parses notice markers", () => {
    expect(parseGitHubMarker("##[notice]FYI")).toEqual({
      type: "notice",
      message: "FYI",
    });
  });

  it("parses debug markers", () => {
    expect(parseGitHubMarker("##[debug]Debug info")).toEqual({
      type: "debug",
      message: "Debug info",
    });
  });

  it("parses command markers", () => {
    expect(parseGitHubMarker("[command]npm test")).toEqual({
      type: "command",
      message: "npm test",
    });
  });

  it("returns null for regular lines", () => {
    expect(parseGitHubMarker("Just a normal log line")).toBeNull();
    expect(parseGitHubMarker("")).toBeNull();
  });

  it("handles markers with empty messages", () => {
    expect(parseGitHubMarker("##[error]")).toEqual({
      type: "error",
      message: undefined,
    });
  });
});

describe("getMarkerClass", () => {
  it("returns correct classes for each marker type", () => {
    expect(getMarkerClass("error")).toContain("red");
    expect(getMarkerClass("warning")).toContain("yellow");
    expect(getMarkerClass("notice")).toContain("blue");
    expect(getMarkerClass("command")).toContain("cyan");
    expect(getMarkerClass("debug")).toContain("muted");
  });

  it("returns empty string for undefined", () => {
    expect(getMarkerClass(undefined)).toBe("");
  });
});

describe("parseLogs", () => {
  it("parses regular log lines", () => {
    const { lines, groups } = parseLogs([
      { timestamp: "2025-01-01T00:00:00Z", body: "Hello" },
      { timestamp: "2025-01-01T00:00:01Z", body: "World" },
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0].body).toBe("Hello");
    expect(groups).toHaveLength(0);
  });

  it("parses groups", () => {
    const { lines, groups } = parseLogs([
      { timestamp: "2025-01-01T00:00:00Z", body: "##[group]Setup" },
      { timestamp: "2025-01-01T00:00:01Z", body: "Installing deps" },
      { timestamp: "2025-01-01T00:00:02Z", body: "##[endgroup]" },
    ]);

    expect(lines).toHaveLength(3);
    expect(lines[0].isGroupStart).toBe("Setup");
    expect(lines[2].isGroupEnd).toBe(true);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Setup");
    expect(groups[0].startIndex).toBe(0);
    expect(groups[0].endIndex).toBe(2);
  });

  it("handles unclosed groups", () => {
    const { groups } = parseLogs([
      { timestamp: "2025-01-01T00:00:00Z", body: "##[group]Open group" },
      { timestamp: "2025-01-01T00:00:01Z", body: "content" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].endIndex).toBe(1);
  });

  it("marks error/warning/notice/debug lines", () => {
    const { lines } = parseLogs([
      { timestamp: "2025-01-01T00:00:00Z", body: "##[error]Fail!" },
      { timestamp: "2025-01-01T00:00:01Z", body: "##[warning]Careful" },
    ]);

    expect(lines[0].markerType).toBe("error");
    expect(lines[1].markerType).toBe("warning");
  });
});

function makeLog(body: string, offsetSeconds = 0): LogEntry {
  const ts = new Date(Date.UTC(2025, 0, 1, 0, 0, offsetSeconds)).toISOString();
  return { timestamp: ts, body };
}

describe("computeVisibleLines", () => {
  it("returns all lines when there are no groups", () => {
    const { lines, groups } = parseLogs([
      makeLog("line 1", 0),
      makeLog("line 2", 1),
      makeLog("line 3", 2),
    ]);

    const { visible } = computeVisibleLines(lines, groups, new Set());
    expect(visible).toHaveLength(3);
    expect(visible.map((v) => v.displayLine)).toEqual([1, 2, 3]);
  });

  it("hides group children when collapsed", () => {
    const { lines, groups } = parseLogs([
      makeLog("##[group]Setup", 0),
      makeLog("child 1", 1),
      makeLog("child 2", 2),
      makeLog("##[endgroup]", 3),
      makeLog("after group", 4),
    ]);

    const collapsed = new Set(groups.map((g) => g.id));
    const { visible } = computeVisibleLines(lines, groups, collapsed);

    // Only group header + line after group
    expect(visible.map((v) => lines[v.index].body)).toEqual([
      "Setup",
      "after group",
    ]);
  });

  it("shows group children when expanded", () => {
    const { lines, groups } = parseLogs([
      makeLog("##[group]Setup", 0),
      makeLog("child 1", 1),
      makeLog("child 2", 2),
      makeLog("##[endgroup]", 3),
    ]);

    const { visible } = computeVisibleLines(lines, groups, new Set());
    expect(visible.map((v) => lines[v.index].body)).toEqual([
      "Setup",
      "child 1",
      "child 2",
    ]);
  });

  it("does not count endgroup lines in displayLine numbers", () => {
    const { lines, groups } = parseLogs([
      makeLog("##[group]Setup", 0),
      makeLog("child", 1),
      makeLog("##[endgroup]", 2),
      makeLog("after", 3),
    ]);

    const { visible } = computeVisibleLines(lines, groups, new Set());
    // displayLine: Setup=1, child=2, after=3 (endgroup skipped)
    expect(visible.map((v) => v.displayLine)).toEqual([1, 2, 3]);
  });

  it("indents nested group children", () => {
    const { lines, groups } = parseLogs([
      makeLog("##[group]Outer", 0),
      makeLog("##[group]Inner", 1),
      makeLog("deep child", 2),
      makeLog("##[endgroup]", 3),
      makeLog("##[endgroup]", 4),
    ]);

    const { visible } = computeVisibleLines(lines, groups, new Set());
    const deepChild = visible.find((v) => lines[v.index].body === "deep child");
    expect(deepChild?.indentLevel).toBe(2);
  });

  it("detects uniform timestamps within a group", () => {
    const { lines, groups } = parseLogs([
      makeLog("##[group]Same time", 0),
      makeLog("child 1", 0),
      makeLog("child 2", 0),
      makeLog("##[endgroup]", 0),
    ]);

    const { groupsWithUniformTimestamps } = computeVisibleLines(
      lines,
      groups,
      new Set(),
    );
    expect(groupsWithUniformTimestamps.has(groups[0].id)).toBe(true);
  });

  it("detects non-uniform timestamps within a group", () => {
    const { lines, groups } = parseLogs([
      makeLog("##[group]Diff time", 0),
      makeLog("child 1", 0),
      makeLog("child 2", 5),
      makeLog("##[endgroup]", 5),
    ]);

    const { groupsWithUniformTimestamps } = computeVisibleLines(
      lines,
      groups,
      new Set(),
    );
    expect(groupsWithUniformTimestamps.has(groups[0].id)).toBe(false);
  });

  it("maps lines to their innermost group", () => {
    const { lines, groups } = parseLogs([
      makeLog("##[group]Outer", 0),
      makeLog("##[group]Inner", 1),
      makeLog("deep child", 2),
      makeLog("##[endgroup]", 3),
      makeLog("outer child", 4),
      makeLog("##[endgroup]", 5),
    ]);

    const { lineToGroup } = computeVisibleLines(lines, groups, new Set());
    // "deep child" at index 2 belongs to the inner group (higher depth)
    const innerGroup = groups.find((g) => g.name === "Inner")!;
    expect(lineToGroup.get(2)?.groupId).toBe(innerGroup.id);
  });

  it("handles multiple sibling groups", () => {
    const { lines, groups } = parseLogs([
      makeLog("##[group]First", 0),
      makeLog("child a", 1),
      makeLog("##[endgroup]", 2),
      makeLog("##[group]Second", 3),
      makeLog("child b", 4),
      makeLog("##[endgroup]", 5),
    ]);

    // Collapse only first group
    const collapsed = new Set([groups[0].id]);
    const { visible } = computeVisibleLines(lines, groups, collapsed);

    expect(visible.map((v) => lines[v.index].body)).toEqual([
      "First",
      "Second",
      "child b",
    ]);
  });
});
