import { describe, expect, it } from "vitest";
import { getMarkerClass, parseGitHubMarker, parseLogs } from "./log-parser";

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
