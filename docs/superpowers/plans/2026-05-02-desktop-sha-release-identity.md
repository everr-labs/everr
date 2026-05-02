# Desktop SHA Release Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual desktop version bumps while using the commit SHA as the human release identity and a generated SemVer as the Tauri/macOS updater version.

**Architecture:** Add a small release identity helper in the desktop build scripts. CI derives `platformVersion` from the checked-in development version plus `GITHUB_RUN_NUMBER`, derives `releaseSha` from `GITHUB_SHA`, passes a temporary Tauri config override to `tauri build`, and writes SHA-aware release metadata. The app exposes the short SHA through a small Tauri command and displays it on the Settings page.

**Tech Stack:** TypeScript build scripts, Vitest, Tauri v2, Rust commands, React.

---

### Task 1: Release Identity Helper

**Files:**
- Modify: `packages/desktop-app/scripts/build-support.ts`
- Modify: `packages/desktop-app/scripts/build-support.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests under `describe("build-support version helpers", ...)`:

```ts
it("derives CI release identity from GitHub Actions env vars", () => {
  expect(
    resolveDesktopReleaseIdentity({
      env: {
        GITHUB_SHA: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
        GITHUB_RUN_NUMBER: "1234",
      },
      fallbackVersion: "0.1.30",
      fallbackSha: "localsha",
    }),
  ).toEqual({
    platformVersion: "0.1.1264",
    releaseSha: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
    releaseShortSha: "82efe1c",
    source: "github-actions",
  });
});

it("uses local fallbacks outside GitHub Actions", () => {
  expect(
    resolveDesktopReleaseIdentity({
      env: {},
      fallbackVersion: "0.1.30",
      fallbackSha: "localsha123456",
    }),
  ).toEqual({
    platformVersion: "0.1.30",
    releaseSha: "localsha123456",
    releaseShortSha: "localsh",
    source: "local",
  });
});

it("rejects invalid generated platform versions", () => {
  expect(() =>
    resolveDesktopReleaseIdentity({
      env: {
        GITHUB_SHA: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
        GITHUB_RUN_NUMBER: "not-a-number",
      },
      fallbackVersion: "0.1.30",
      fallbackSha: "localsha",
    }),
  ).toThrow(/GITHUB_RUN_NUMBER/);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @everr/desktop-app exec vitest run scripts/build-support.test.ts
```

Expected: tests fail because `resolveDesktopReleaseIdentity` is not exported.

- [ ] **Step 3: Implement helper**

Export:

```ts
export type DesktopReleaseIdentity = {
  platformVersion: string;
  releaseSha: string;
  releaseShortSha: string;
  source: "github-actions" | "local";
};

export function resolveDesktopReleaseIdentity(options: {
  env?: NodeJS.ProcessEnv;
  fallbackVersion: string;
  fallbackSha?: string;
}): DesktopReleaseIdentity;
```

Rules:
- If both `GITHUB_SHA` and `GITHUB_RUN_NUMBER` are present, return `platformVersion = <fallback major>.<fallback minor>.<fallback patch + runNumber>`.
- Validate the generated SemVer with the existing SemVer validation.
- Use the first 7 characters for `releaseShortSha`.
- Outside CI, use `fallbackVersion` and `fallbackSha ?? "unknown"`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @everr/desktop-app exec vitest run scripts/build-support.test.ts
```

Expected: all build-support tests pass.

### Task 2: Build With Generated Version

**Files:**
- Modify: `packages/desktop-app/scripts/build-desktop.ts`
- Modify: `packages/desktop-app/scripts/build-support.ts`
- Add or modify tests in `packages/desktop-app/scripts/build-support.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for a config override writer:

```ts
it("writes a Tauri config override with the generated platform version", async () => {
  const rootDir = await makeTempDir();
  const overridePath = path.join(rootDir, "release-tauri.conf.json");

  await expect(
    writeDesktopReleaseTauriConfigOverride({
      outputPath: overridePath,
      platformVersion: "0.1.1264",
    }),
  ).resolves.toBe(overridePath);

  await expect(readFile(overridePath, "utf8")).resolves.toBe(
    `${JSON.stringify({ version: "0.1.1264" }, null, 2)}\n`,
  );
});

it("rejects raw SHAs as Tauri platform versions", async () => {
  const rootDir = await makeTempDir();

  await expect(
    writeDesktopReleaseTauriConfigOverride({
      outputPath: path.join(rootDir, "bad.conf.json"),
      platformVersion: "82efe1c",
    }),
  ).rejects.toThrow(/semantic version/);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @everr/desktop-app exec vitest run scripts/build-support.test.ts
```

Expected: tests fail because `writeDesktopReleaseTauriConfigOverride` is not exported.

- [ ] **Step 3: Implement override writer and build integration**

In `build-support.ts`, export `writeDesktopReleaseTauriConfigOverride`.

In `build-desktop.ts`:
- Remove `--release` bump behavior.
- Remove the `bumpDesktopAppVersion` import.
- Read checked-in fallback version from `tauri.conf.json`.
- Resolve release identity.
- For CI builds, write an override file under `target/desktop-release/tauri-release.conf.json`.
- Pass `--config <overridePath>` to `pnpm tauri build`.
- Set env vars for the build: `EVERR_PLATFORM_VERSION`, `EVERR_RELEASE_SHA`, `EVERR_RELEASE_SHORT_SHA`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @everr/desktop-app exec vitest run scripts/build-support.test.ts
```

Expected: all build-support tests pass.

### Task 3: SHA-Aware Release Metadata

**Files:**
- Modify: `packages/desktop-app/scripts/copy-release-artifact.ts`
- Modify: `packages/desktop-app/scripts/copy-release-artifact.test.ts`

- [ ] **Step 1: Write failing tests**

Update manifest and metadata tests to assert:

```ts
expect(JSON.parse(manifest)).toMatchObject({
  version: "0.1.1264",
  notes: "Everr desktop release 82efe1c",
});
```

Update release metadata expectations to include:

```ts
release_sha: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
release_short_sha: "82efe1c",
platform_version: "0.1.1264",
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @everr/desktop-app exec vitest run scripts/copy-release-artifact.test.ts
```

Expected: tests fail because metadata only has `version` and the manifest has no notes.

- [ ] **Step 3: Implement metadata changes**

Use release identity from env/fallback:
- `version` in `latest.json` stays `platformVersion`.
- `latest.json.notes` contains the short SHA.
- `release-metadata.json` includes `release_sha`, `release_short_sha`, and `platform_version`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @everr/desktop-app exec vitest run scripts/copy-release-artifact.test.ts
```

Expected: copy-release-artifact tests pass.

### Task 4: App Visible SHA

**Files:**
- Modify: `packages/desktop-app/src-tauri/build.rs`
- Modify: `packages/desktop-app/src-cli/build.rs`
- Modify: `packages/desktop-app/src-tauri/src/commands.rs`
- Modify: `packages/desktop-app/src-tauri/src/lib.rs`
- Modify: `packages/desktop-app/src/features/developer/developer-page.tsx`
- Modify: `packages/desktop-app/src/App.test.tsx`

- [ ] **Step 1: Write failing frontend test**

Add a test near the Settings page tests:

```ts
it("shows the desktop release SHA on the settings page", async () => {
  renderMainApp({
    commandOverrides: {
      get_build_info: () => ({
        platform_version: "0.1.1264",
        release_sha: "82efe1cf1358e8395b2862c4ee9f93567f10c16e",
        release_short_sha: "82efe1c",
      }),
    },
  });

  await act(async () => {
    await router.navigate({ to: "/settings" });
  });

  expect(await screen.findByText("82efe1c")).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @everr/desktop-app exec vitest run src/App.test.tsx
```

Expected: test fails because the UI does not call `get_build_info` or render the SHA.

- [ ] **Step 3: Implement command and UI**

Add a Rust command:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct BuildInfoResponse {
    pub platform_version: &'static str,
    pub release_sha: &'static str,
    pub release_short_sha: &'static str,
}

#[tauri::command]
pub(crate) fn get_build_info() -> CommandResult<BuildInfoResponse> {
    Ok(BuildInfoResponse {
        platform_version: env!("EVERR_VERSION"),
        release_sha: env!("EVERR_RELEASE_SHA"),
        release_short_sha: env!("EVERR_RELEASE_SHORT_SHA"),
    })
}
```

Register it in `tauri::generate_handler!`.

Update the Rust build scripts to emit:
- `EVERR_VERSION` from `EVERR_PLATFORM_VERSION` if present, else `tauri.conf.json`.
- `EVERR_RELEASE_SHA` from env, else `unknown`.
- `EVERR_RELEASE_SHORT_SHA` from env, else first 7 characters of release SHA or `unknown`.

Update the Settings page to call `invokeCommand("get_build_info")` and render the short SHA in a small existing section.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @everr/desktop-app exec vitest run src/App.test.tsx
```

Expected: App tests pass.

### Task 5: Remove Manual Bump Command and Docs

**Files:**
- Delete: `packages/desktop-app/scripts/bump-desktop-version.ts`
- Delete: `packages/desktop-app/scripts/bump-desktop-version.test.ts`
- Modify: `package.json`
- Modify: `packages/desktop-app/package.json`
- Modify: `CONTRIBUTING.md`
- Modify: `packages/desktop-app/README.md`
- Modify: `docs/desktop-release-secrets.md`

- [ ] **Step 1: Remove command and update docs**

Remove `bump:desktop` scripts and the bump command files. Update docs to say CI derives release identity from `GITHUB_SHA` and `GITHUB_RUN_NUMBER`.

- [ ] **Step 2: Verify no stale references**

Run:

```bash
rg "bump:desktop|bump-desktop-version|--release|manual version bump"
```

Expected: no stale release-flow references remain, except historical/spec text if intentionally kept.

### Task 6: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter @everr/desktop-app test
```

Expected: all desktop app tests pass.

- [ ] **Step 2: Run TypeScript**

```bash
pnpm --filter @everr/desktop-app exec tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run full repo check**

```bash
pnpm check
```

Expected: exits 0. Existing unrelated warnings are acceptable if present.

- [ ] **Step 4: Run workflow sanity checks**

```bash
git diff --check
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/build-signed-desktop-release.yml"); puts "workflow yaml ok"'
```

Expected: both pass.
