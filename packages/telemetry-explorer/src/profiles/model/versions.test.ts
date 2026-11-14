import { describe, expect, it } from "vite-plus/test";
import { pickVersions, type ProfileVersion, versionWindow } from "./versions";

const v3: ProfileVersion = {
  version: "1.3.0",
  firstSeen: "2026-01-02T10:00:00.000Z",
  lastSeen: "2026-01-02T12:00:00.000Z",
};
const v2: ProfileVersion = {
  version: "1.2.0",
  firstSeen: "2026-01-01T09:00:00.000Z",
  lastSeen: "2026-01-02T10:05:00.000Z",
};
const v1: ProfileVersion = {
  version: "1.1.0",
  firstSeen: "2025-12-30T00:00:00.000Z",
  lastSeen: "2026-01-01T09:10:00.000Z",
};
const versions = [v3, v2, v1];

describe("pickVersions", () => {
  it("compares the latest version with the one seen before it", () => {
    expect(pickVersions(versions, {})).toEqual({ comparison: v3, baseline: v2 });
  });

  it("keeps the requested versions", () => {
    expect(pickVersions(versions, { version: "1.2.0", baseVersion: "1.3.0" })).toEqual({
      comparison: v2,
      baseline: v3,
    });
  });

  it("defaults the baseline to the version before the requested one", () => {
    expect(pickVersions(versions, { version: "1.2.0" })).toEqual({ comparison: v2, baseline: v1 });
  });

  it("has no baseline with a single version", () => {
    expect(pickVersions([v3], {})).toEqual({ comparison: v3, baseline: undefined });
  });
});

describe("versionWindow", () => {
  const hour = 60 * 60 * 1000;

  it("ends where the version was last seen and lasts as long as the current range", () => {
    expect(versionWindow(v2, hour)).toEqual({
      from: "2026-01-02T09:05:00.000Z",
      to: "2026-01-02T10:05:00.001Z",
    });
  });

  it("starts no earlier than the version was first seen", () => {
    expect(versionWindow(v3, 24 * hour).from).toBe(v3.firstSeen);
  });
});
