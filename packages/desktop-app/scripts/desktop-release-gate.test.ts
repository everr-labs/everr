import { describe, expect, it } from "vitest";
import {
  evaluateDesktopReleaseGate,
  parseCargoPackageVersion,
  targetsDesktopPackage,
} from "./desktop-release-gate";

const desktopChangeset = `---
"@everr/desktop-app": patch
---

Desktop release notes.
`;

describe("desktop release gate", () => {
  it("releases when a deleted changeset targets the desktop app and versions match", () => {
    expect(
      evaluateDesktopReleaseGate({
        deletedChangesets: [
          {
            path: ".changeset/desktop-release.md",
            contents: desktopChangeset,
          },
        ],
        packageVersion: "0.1.32",
        tauriVersion: "0.1.32",
        cargoVersion: "0.1.32",
      }),
    ).toEqual({
      shouldRelease: true,
      version: "0.1.32",
      artifactName: "everr-desktop-release-0.1.32",
      reason: "Deleted changeset .changeset/desktop-release.md targets @everr/desktop-app.",
    });
  });

  it("skips when deleted changesets do not target the desktop app", () => {
    expect(
      evaluateDesktopReleaseGate({
        deletedChangesets: [
          {
            path: ".changeset/action-release.md",
            contents: `---
"@everr/action": patch
---

Action release notes mention @everr/desktop-app in the body only.
`,
          },
        ],
        packageVersion: "0.1.32",
        tauriVersion: "0.1.32",
        cargoVersion: "0.1.32",
      }),
    ).toEqual({
      shouldRelease: false,
      reason: "No deleted changeset targets @everr/desktop-app.",
    });
  });

  it("fails when desktop versions disagree", () => {
    expect(() =>
      evaluateDesktopReleaseGate({
        deletedChangesets: [
          {
            path: ".changeset/desktop-release.md",
            contents: desktopChangeset,
          },
        ],
        packageVersion: "0.1.32",
        tauriVersion: "0.1.31",
        cargoVersion: "0.1.32",
      }),
    ).toThrow(
      "Desktop release versions must match: package.json=0.1.32, tauri.conf.json=0.1.31, Cargo.toml=0.1.32.",
    );
  });

  it("fails when the desktop package version is not semantic", () => {
    expect(() =>
      evaluateDesktopReleaseGate({
        deletedChangesets: [
          {
            path: ".changeset/desktop-release.md",
            contents: desktopChangeset,
          },
        ],
        packageVersion: "82efe1c",
        tauriVersion: "82efe1c",
        cargoVersion: "82efe1c",
      }),
    ).toThrow('Unsupported desktop app version "82efe1c". Expected X.Y.Z.');
  });

  it("detects the desktop package only in changeset frontmatter", () => {
    expect(targetsDesktopPackage(desktopChangeset)).toBe(true);
    expect(
      targetsDesktopPackage(`---
"@everr/action": patch
---

Body mentions @everr/desktop-app.
`),
    ).toBe(false);
  });

  it("reads the Cargo package version", () => {
    expect(
      parseCargoPackageVersion(`[workspace]
members = []

[package]
name = "everr-app"
version = "0.1.32"
edition = "2021"
`),
    ).toBe("0.1.32");
  });
});
