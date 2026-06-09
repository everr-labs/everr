# Linux CLI Release Design

## Goal

Make the Everr CLI available to Linux users through the existing deploy-managed
download path. The first release targets Linux arm64 and Linux x86_64. When a
Linux user runs `everr setup`, setup should complete cloud, repository, email,
and skill onboarding without attempting any desktop app install or launch steps.

## Assumptions

- Linux arm64 builds can use the existing Blacksmith Ubuntu ARM runner.
- Linux x86_64 builds can use `ubuntu-24.04`.
- The deploy repo can consume a GitHub Actions artifact from this repository
  when it receives a repository dispatch event with the source run metadata.
- Linux CLI releases do not need embedded local collector or chDB assets in this
  iteration. Local collector commands may keep their existing platform guard.

## Architecture

Keep the macOS desktop release workflow unchanged. Extend the CLI workflow so it
builds and publishes Linux CLI release artifacts independently:

- `everr-linux-arm64`
- `everr-linux-arm64.sha256`
- `everr-linux-x86_64`
- `everr-linux-x86_64.sha256`

The workflow should test the CLI crate, build both release binaries, run a smoke
test on each binary with `--help`, upload one release payload artifact, attest
the checksums, and dispatch the deploy repository with the artifact name, source
repository, run id, commit SHA, release kind, and the version from
`packages/desktop-app/package.json`. The deploy repository must listen for the
Linux CLI dispatch, validate the Linux artifact payload, and upload the
architecture-specific Linux binaries and checksums into the existing
`everr-app` download prefix without overwriting desktop app metadata objects.

The Linux release path should use raw Cargo builds rather than
`pnpm build:cli:release`, because the Node release wrapper prepares macOS-only
embedded collector and chDB resources. This keeps the first Linux release small
and avoids pretending unsupported local desktop features are available.

## Installer Behavior

Update `packages/docs/public/install.sh` and the local dev variant to select a
download asset by platform and architecture:

- macOS arm64 continues downloading the existing `everr` and `everr.sha256`
  assets from the desktop release path.
- Linux `aarch64` and `arm64` download `everr-linux-arm64` and its checksum.
- Linux `x86_64` and `amd64` download `everr-linux-x86_64` and its checksum.
- Other OS or CPU combinations fail with a clear unsupported platform message.

The installer should still install the binary as `~/.local/bin/everr` and run
guided setup on an interactive terminal.

## Setup Behavior

Keep the shared setup sequence intact:

1. Authenticate with Everr Cloud.
2. Load identity and organization context.
3. Rename/import organization repositories when applicable.
4. Configure notification emails.
5. Install bundled skills.
6. Mark cloud and local setup state complete.
7. Print next steps.

Gate only the desktop app step by target OS. On macOS, keep the existing desktop
install/start behavior. On Linux, skip the desktop app step before it checks
`/Applications`, runs `pgrep Everr`, calls `open`, downloads a DMG, or invokes
`hdiutil`. Linux setup should emit one short remark that desktop setup is being
skipped on Linux, then continue the rest of setup.

## Error Handling

- Unsupported installer targets fail before downloading anything.
- Missing Linux release artifacts fail the workflow before dispatching the
  deploy repo.
- Checksum generation and smoke tests must run before uploading the release
  artifact.
- Desktop setup failures remain macOS-only and should not affect Linux setup.

## Testing

Add focused coverage for the changed behavior:

- Shell syntax checks for `install.sh` and `install-dev.sh`.
- Installer platform-selection tests should be added only if the selection logic
  is extracted into a testable helper; otherwise keep the shell inline and
  validate with shell syntax checks.
- Rust tests for the setup desktop gate so Linux skips the desktop step and
  macOS remains eligible.
- Existing CLI tests for command parsing and telemetry commands.
- Package script tests that cover artifact publishing helpers if those helpers
  are reused or extended.

Local verification should run targeted Rust tests for `packages/desktop-app/src-cli`,
the relevant package script tests, and the available shell checks. The GitHub
Actions workflow provides the authoritative cross-platform build verification
for both Linux architectures.

## Out Of Scope

- Linux desktop app support.
- Linux embedded local collector or chDB support.
- Changing macOS desktop signing, notarization, or updater behavior.
- Creating GitHub Releases for the CLI.
