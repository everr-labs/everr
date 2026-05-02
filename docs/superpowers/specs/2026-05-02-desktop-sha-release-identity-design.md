# Desktop SHA Release Identity Design

## Status

Approved for implementation planning.

## Context

The desktop release flow currently treats the committed Tauri/package version as the release version. That means release preparation requires a manual version bump before CI can build a distinct updater version.

We want to remove that manual bump. Human-facing release identity should be the commit SHA that produced the artifact. Platform-facing version fields still need to stay numeric because Tauri, its updater manifest, and macOS bundle metadata require SemVer or numeric dotted versions.

## Goals

- Remove manual desktop version bumps from the release flow.
- Use the commit SHA as the release identity shown to humans.
- Keep Tauri updater comparisons valid by generating a monotonically increasing SemVer in CI.
- Keep macOS bundle metadata valid for signing, notarization, and Gatekeeper.
- Avoid committing version-only changes to `package.json`, `tauri.conf.json`, or Cargo manifests for each release.

## Non-Goals

- Do not make raw SHAs the native macOS bundle version.
- Do not replace the Tauri updater.
- Do not introduce a release server. The static `latest.json` flow stays.
- Do not create a larger product About page unless needed for the SHA display.

## Constraints

- Tauri app config `version` must be SemVer.
- Tauri updater `latest.json.version` must be SemVer.
- macOS `CFBundleShortVersionString` must be numeric and period-separated.
- Git commit SHAs are not monotonic, so they cannot drive updater ordering by themselves.

## Version Model

Each release has two identifiers:

- `release_sha`: the full commit SHA, for humans and traceability.
- `platform_version`: an auto-generated SemVer, for Tauri/macOS/updater compatibility.

For CI builds, derive:

- `release_sha = GITHUB_SHA`
- `release_short_sha = first 7-12 characters of GITHUB_SHA`
- `platform_version = <checked-in major>.<checked-in minor>.<checked-in patch + GITHUB_RUN_NUMBER>`

`GITHUB_RUN_NUMBER` is monotonic for the workflow, so later workflow runs naturally produce later SemVer patch values above the checked-in development version. Reruns of the same workflow run keep the same version, which is fine because they are retrying the same release attempt.

For local builds without GitHub Actions env vars:

- Keep the checked-in development version from `tauri.conf.json`.
- Resolve a best-effort git SHA from `git rev-parse HEAD`.
- Use `unknown` only when git metadata is unavailable.

## Build Flow

1. CI checks out the target commit.
2. The desktop build script resolves release identity from GitHub env vars.
3. The build script passes `platform_version` into Tauri without editing committed files.
4. Rust build scripts receive the same platform version and release SHA through env vars.
5. Tauri builds the signed app, DMG, and updater archive using the generated platform version.
6. Artifact staging writes the commit SHA into release metadata and updater notes.
7. The uploaded Actions artifact remains named with `github.sha`.

The implementation should prefer a temporary generated Tauri config or Tauri config override, not an in-place edit of `src-tauri/tauri.conf.json`.

## Metadata

`target/desktop-release/release-metadata.json` should include:

- `release_sha`
- `release_short_sha`
- `platform_version`
- existing GitHub build fields
- existing artifact file details

`target/desktop-release/everr-app/latest.json` should keep:

- `version: platform_version`
- updater archive URL
- updater signature
- `pub_date`

It may include the short SHA in `notes`, because `notes` is an expected updater field and keeps the manifest human-readable.

## User Visibility

The visible SHA should be shown inside Everr itself, preferably in an existing low-risk surface first:

- Developer page, or
- Settings page footer/status area.

The displayed value should be `release_short_sha`, with the full SHA available in metadata/logs. Finder/Get Info will still show the numeric platform version because macOS requires that format.

## Cleanup

Remove or replace:

- `pnpm bump:desktop`
- `bump-desktop-version.ts`
- bump command tests
- docs that tell maintainers to manually bump desktop versions before release

Keep a static checked-in development version for local builds.

## Testing

Add tests for:

- CI release identity derivation from `GITHUB_SHA` and `GITHUB_RUN_NUMBER`.
- local fallback behavior when GitHub env vars are absent.
- updater manifest uses `platform_version`, not raw SHA.
- release metadata includes SHA and platform version.
- build scripts reject raw SHA as the platform version.

Run the existing desktop script tests, TypeScript checks, and workflow YAML parse checks.

The real end-to-end check remains the signed desktop release workflow on a same-repo branch, followed by artifact download and inspection.

## References

- Tauri config version documentation: https://v2.tauri.app/reference/config/#version
- Tauri updater static JSON documentation: https://v2.tauri.app/plugin/updater/#static-json-file
- Apple bundle short version documentation: https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring
