# Linux CLI Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release Linux arm64 and x86_64 CLI binaries through the existing deploy-managed download path, and skip desktop app setup from Linux CLI setup.

**Architecture:** Keep the macOS desktop release flow unchanged. Add Linux-specific CLI artifacts to the CLI workflow and deploy dispatch path, update installer asset selection, and gate only the desktop app setup step by target OS.

**Tech Stack:** Rust CLI, bash installers, GitHub Actions, pnpm/Vitest for script workflow tests.

---

## File Structure

- Modify `packages/desktop-app/src-cli/src/onboarding.rs`
  - Add a small target-OS gate around the existing desktop setup function.
  - Add focused unit tests for Linux skip and macOS eligibility.
- Modify `packages/docs/public/install.sh`
  - Select the download asset for macOS arm64, Linux arm64, and Linux x86_64.
  - Keep the installed binary name as `everr`.
- Modify `packages/docs/public/install-dev.sh`
  - Mirror the production installer logic against the localhost base URL.
- Modify `.github/workflows/build-everr-cli.yml`
  - Build and upload Linux arm64 and x86_64 release artifacts.
  - Generate checksums, attest the final payload on main, and dispatch the deploy repo.
- Create or modify `packages/desktop-app/scripts/cli-release-workflow.test.ts`
  - Assert that the workflow includes both Linux targets, final artifact upload, checksum attestation, and deploy dispatch.
- Companion deploy repo change: modify `everr-deploy/.github/workflows/deploy-desktop-app.yml`
  - Accept the `cli-linux-release` dispatch event.
  - Validate and attest the Linux CLI payload.
  - Upload `everr-linux-arm64`, `everr-linux-arm64.sha256`, `everr-linux-x86_64`, and `everr-linux-x86_64.sha256` to the existing `everr-app` prefix.

## Baseline

Already run before implementation from `/Users/guidodorsi/workspace/everr/.worktrees/linux-cli-release`:

- `cargo test --manifest-path packages/desktop-app/src-cli/Cargo.toml onboarding::tests`
  - Passed: 14 onboarding tests.
- `bash -n packages/docs/public/install.sh`
  - Passed.
- `bash -n packages/docs/public/install-dev.sh`
  - Passed.
- `pnpm --filter @everr/desktop-app test -- build-support.test.ts desktop-release-workflow.test.ts`
  - Passed after allowing dependency access.

---

### Task 1: Skip Desktop Setup On Linux

**Files:**
- Modify: `packages/desktop-app/src-cli/src/onboarding.rs`

- [ ] **Step 1: Add failing tests for the desktop setup platform gate**

Add tests in the existing `#[cfg(test)] mod tests` in `packages/desktop-app/src-cli/src/onboarding.rs`:

```rust
#[test]
fn desktop_setup_runs_on_macos() {
    assert!(super::should_run_desktop_app_setup("macos"));
}

#[test]
fn desktop_setup_skips_on_linux() {
    assert!(!super::should_run_desktop_app_setup("linux"));
}

#[test]
fn desktop_setup_skip_message_names_linux() {
    assert_eq!(
        super::desktop_setup_skip_message("linux"),
        "Skipping desktop app setup on Linux."
    );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path packages/desktop-app/src-cli/Cargo.toml onboarding::tests::desktop_setup
```

Expected: FAIL because `should_run_desktop_app_setup` and `desktop_setup_skip_message` do not exist.

- [ ] **Step 3: Add the platform gate and wire it into setup**

In `packages/desktop-app/src-cli/src/onboarding.rs`, replace the direct call in `run()`:

```rust
step_install_desktop_app().await?;
```

with:

```rust
step_install_desktop_app_for_target(std::env::consts::OS).await?;
```

Add these helpers near `step_install_desktop_app`:

```rust
fn should_run_desktop_app_setup(target_os: &str) -> bool {
    target_os == "macos"
}

fn desktop_setup_skip_message(target_os: &str) -> &'static str {
    match target_os {
        "linux" => "Skipping desktop app setup on Linux.",
        _ => "Skipping desktop app setup on this platform.",
    }
}

async fn step_install_desktop_app_for_target(target_os: &str) -> Result<bool> {
    if should_run_desktop_app_setup(target_os) {
        return step_install_desktop_app().await;
    }

    cliclack::log::remark(desktop_setup_skip_message(target_os))?;
    Ok(false)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cargo test --manifest-path packages/desktop-app/src-cli/Cargo.toml onboarding::tests::desktop_setup
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Run the full onboarding unit-test subset**

Run:

```bash
cargo test --manifest-path packages/desktop-app/src-cli/Cargo.toml onboarding::tests
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop-app/src-cli/src/onboarding.rs
git commit -m "Skip desktop setup outside macOS"
```

---

### Task 2: Select Linux CLI Assets In Installers

**Files:**
- Modify: `packages/docs/public/install.sh`
- Modify: `packages/docs/public/install-dev.sh`

- [ ] **Step 1: Update both installers to choose assets by OS and architecture**

In both scripts, keep the existing `DOWNLOAD_BASE_URL`, `INSTALL_DIR`, and `INSTALL_PATH` behavior. Replace the fixed `BINARY_NAME="everr"` plus macOS-only checks with this logic after `os="$(uname -s)"` and `arch="$(uname -m)"`:

```bash
case "${os}:${arch}" in
  Darwin:arm64)
    BINARY_NAME="everr"
    ;;
  Linux:aarch64|Linux:arm64)
    BINARY_NAME="everr-linux-arm64"
    ;;
  Linux:x86_64|Linux:amd64)
    BINARY_NAME="everr-linux-x86_64"
    ;;
  *)
    echo "everr install script does not support ${os} ${arch}." >&2
    exit 1
    ;;
esac

CHECKSUM_NAME="${BINARY_NAME}.sha256"
```

Update the download and checksum paths to use `CHECKSUM_NAME`:

```bash
binary_url="${DOWNLOAD_BASE_URL%/}/${BINARY_NAME}"
checksum_url="${DOWNLOAD_BASE_URL%/}/${CHECKSUM_NAME}"

echo "Downloading Everr CLI..."
curl -fsSL "${binary_url}" -o "${tmp_dir}/${BINARY_NAME}"
curl -fsSL "${checksum_url}" -o "${tmp_dir}/${CHECKSUM_NAME}"
```

Replace the checksum block with a portable verifier:

```bash
(
  cd "${tmp_dir}"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "${CHECKSUM_NAME}" > /dev/null
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${CHECKSUM_NAME}" > /dev/null
  else
    echo "No SHA-256 checksum tool found. Install shasum or sha256sum." >&2
    exit 1
  fi
)
```

Keep the installed filename stable:

```bash
mv "${tmp_dir}/${BINARY_NAME}" "${INSTALL_PATH}"
```

- [ ] **Step 2: Run shell syntax checks**

Run:

```bash
bash -n packages/docs/public/install.sh
bash -n packages/docs/public/install-dev.sh
```

Expected: both commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/docs/public/install.sh packages/docs/public/install-dev.sh
git commit -m "Support Linux CLI installer assets"
```

---

### Task 3: Release Linux CLI Artifacts From GitHub Actions

**Files:**
- Modify: `.github/workflows/build-everr-cli.yml`
- Create: `packages/desktop-app/scripts/cli-release-workflow.test.ts`

- [ ] **Step 1: Add workflow tests first**

Create `packages/desktop-app/scripts/cli-release-workflow.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoDir } from "./build-support";

const workflowPath = path.join(repoDir, ".github/workflows/build-everr-cli.yml");

describe("CLI release workflow", () => {
  it("builds Linux arm64 and x86_64 artifacts", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("everr-linux-arm64");
    expect(workflow).toContain("everr-linux-x86_64");
    expect(workflow).toContain("blacksmith-2vcpu-ubuntu-2404-arm");
    expect(workflow).toContain("ubuntu-24.04");
  });

  it("uploads and attests the merged Linux CLI release payload", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("everr-cli-linux-release-${{ github.sha }}");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("actions/attest@v4");
    expect(workflow).toContain("subject-checksums: target/cli-release/SHA256SUMS");
  });

  it("dispatches the deploy repository with the Linux CLI artifact name", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("event-type: cli-linux-release");
    expect(workflow).toContain("repository: everr-labs/everr-deploy");
    expect(workflow).toContain("\"artifact_name\": \"everr-cli-linux-release-${{ github.sha }}\"");
  });
});
```

- [ ] **Step 2: Run the workflow tests to verify they fail**

Run:

```bash
pnpm --filter @everr/desktop-app test -- cli-release-workflow.test.ts
```

Expected: FAIL because the workflow does not yet include the Linux release payload or dispatch.

- [ ] **Step 3: Replace the CLI workflow with a build matrix plus publish job**

Update `.github/workflows/build-everr-cli.yml` to this shape:

```yaml
name: Everr CLI CI

permissions:
  contents: read
  id-token: write
  attestations: write

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

on:
  pull_request:
    paths:
      - .github/workflows/build-everr-cli.yml
      - packages/desktop-app/src-cli/**
      - crates/everr-core/**
      - Makefile
      - packages/docs/Dockerfile
      - packages/docs/public/install.sh
      - packages/docs/public/install-dev.sh
      - packages/docs/content/docs/cli/**
  push:
    branches: [main]
    paths:
      - .github/workflows/build-everr-cli.yml
      - packages/desktop-app/src-cli/**
      - crates/everr-core/**
      - Makefile
      - packages/docs/Dockerfile
      - packages/docs/public/install.sh
      - packages/docs/public/install-dev.sh
      - packages/docs/content/docs/cli/**

jobs:
  build:
    name: Build (${{ matrix.name }})
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: linux-arm64
            runner: blacksmith-2vcpu-ubuntu-2404-arm
            asset: everr-linux-arm64
          - name: linux-x86_64
            runner: ubuntu-24.04
            asset: everr-linux-x86_64
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Collect resource usage
        uses: ./.github/actions/everr-action
        with:
          check-run-id: ${{ job.check_run_id }}

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable

      - name: Cache Rust dependencies
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: . -> target

      - name: Test
        run: cargo test --manifest-path packages/desktop-app/src-cli/Cargo.toml

      - name: Build release binary
        run: cargo build --release --manifest-path packages/desktop-app/src-cli/Cargo.toml

      - name: Stage release binary
        run: |
          set -euo pipefail
          mkdir -p target/cli-release
          cp target/release/everr "target/cli-release/${{ matrix.asset }}"
          chmod +x "target/cli-release/${{ matrix.asset }}"
          (
            cd target/cli-release
            sha256sum "${{ matrix.asset }}" > "${{ matrix.asset }}.sha256"
          )

      - name: Smoke test
        run: ./target/cli-release/${{ matrix.asset }} --help

      - name: Upload architecture artifact
        uses: actions/upload-artifact@v4
        with:
          name: everr-cli-${{ matrix.name }}-${{ github.sha }}
          path: |
            target/cli-release/${{ matrix.asset }}
            target/cli-release/${{ matrix.asset }}.sha256
          if-no-files-found: error
          retention-days: 14
          compression-level: 0

  publish-linux-release:
    name: Publish Linux Release Payload
    runs-on: ubuntu-24.04
    needs: build
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download architecture artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: everr-cli-linux-*-${{ github.sha }}
          path: target/cli-release
          merge-multiple: true

      - name: Validate release payload
        run: |
          set -euo pipefail
          for asset in everr-linux-arm64 everr-linux-x86_64; do
            test -x "target/cli-release/${asset}"
            test -f "target/cli-release/${asset}.sha256"
            (
              cd target/cli-release
              sha256sum -c "${asset}.sha256"
            )
          done

      - name: Read CLI release version
        id: version
        run: |
          set -euo pipefail
          version="$(node -p "require('./packages/desktop-app/package.json').version")"
          echo "version=${version}" >> "$GITHUB_OUTPUT"

      - name: Write release metadata and checksums
        run: |
          set -euo pipefail
          (
            cd target/cli-release
            sha256sum everr-linux-arm64 everr-linux-arm64.sha256 everr-linux-x86_64 everr-linux-x86_64.sha256 > SHA256SUMS
          )
          node - <<'NODE'
          const { readdirSync, statSync, writeFileSync } = require("node:fs");
          const { createHash } = require("node:crypto");
          const { join } = require("node:path");
          const root = "target/cli-release";
          const files = readdirSync(root)
            .filter((name) => name !== "release-metadata.json")
            .sort()
            .map((name) => {
              const path = join(root, name);
              return {
                path: name,
                sha256: createHash("sha256").update(require("node:fs").readFileSync(path)).digest("hex"),
                size: statSync(path).size,
              };
            });
          writeFileSync(join(root, "release-metadata.json"), `${JSON.stringify({
            schema_version: 1,
            product: "Everr CLI",
            version: process.env.CLI_VERSION,
            release_sha: process.env.GITHUB_SHA,
            targets: ["linux-arm64", "linux-x86_64"],
            build: {
              github_repository: process.env.GITHUB_REPOSITORY,
              github_ref: process.env.GITHUB_REF,
              github_sha: process.env.GITHUB_SHA,
              github_run_id: process.env.GITHUB_RUN_ID,
              created_at: new Date().toISOString(),
            },
            files,
          }, null, 2)}\n`);
          NODE
        env:
          CLI_VERSION: ${{ steps.version.outputs.version }}

      - name: Attest Linux CLI checksums
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: actions/attest@v4
        with:
          subject-checksums: target/cli-release/SHA256SUMS

      - name: Upload Linux CLI release artifact
        id: upload-linux-cli-release
        uses: actions/upload-artifact@v4
        with:
          name: everr-cli-linux-release-${{ github.sha }}
          path: target/cli-release
          if-no-files-found: error
          retention-days: 14
          compression-level: 0

      - name: Generate GitHub App token
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        id: app-token
        uses: actions/create-github-app-token@v3
        with:
          app-id: ${{ secrets.EVERR_DEPLOY_BOT_APP_ID }}
          private-key: ${{ secrets.EVERR_DEPLOY_BOT_PRIVATE_KEY }}
          owner: everr-labs
          repositories: everr-deploy

      - name: Dispatch Linux CLI release event
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: peter-evans/repository-dispatch@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          repository: everr-labs/everr-deploy
          event-type: cli-linux-release
          client-payload: |
            {
              "source_repo": "${{ github.repository }}",
              "run_id": "${{ github.run_id }}",
              "sha": "${{ github.sha }}",
              "version": "${{ steps.version.outputs.version }}",
              "artifact_name": "everr-cli-linux-release-${{ github.sha }}"
            }
```

- [ ] **Step 4: Run workflow tests to verify they pass**

Run:

```bash
pnpm --filter @everr/desktop-app test -- cli-release-workflow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing desktop workflow tests**

Run:

```bash
pnpm --filter @everr/desktop-app test -- desktop-release-workflow.test.ts cli-release-workflow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/build-everr-cli.yml packages/desktop-app/scripts/cli-release-workflow.test.ts
git commit -m "Release Linux CLI artifacts from Actions"
```

---

### Task 4: Final Verification

**Files:**
- Verify all files changed by Tasks 1-3.

- [ ] **Step 1: Run Rust CLI tests**

Run:

```bash
cargo test --manifest-path packages/desktop-app/src-cli/Cargo.toml
```

Expected: PASS.

- [ ] **Step 2: Run package script tests**

Run:

```bash
pnpm --filter @everr/desktop-app test -- build-support.test.ts desktop-release-workflow.test.ts cli-release-workflow.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run installer shell syntax checks**

Run:

```bash
bash -n packages/docs/public/install.sh
bash -n packages/docs/public/install-dev.sh
```

Expected: PASS.

- [ ] **Step 4: Build local release CLI**

Run:

```bash
cargo build --release --manifest-path packages/desktop-app/src-cli/Cargo.toml
./target/release/everr --help
```

Expected: build succeeds and help output prints command usage.

- [ ] **Step 5: Review final diff**

Run:

```bash
git diff --stat main...HEAD
git diff main...HEAD -- .github/workflows/build-everr-cli.yml packages/docs/public/install.sh packages/docs/public/install-dev.sh packages/desktop-app/src-cli/src/onboarding.rs packages/desktop-app/scripts/cli-release-workflow.test.ts
```

Expected: diff is limited to the approved spec, plan, setup gate, installer scripts, CLI workflow, and workflow tests.
