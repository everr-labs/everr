# Changeset Release Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop app and CLI source releases run from changeset-created `@everr/desktop-app@*` tags instead of manual workflow dispatch.

**Architecture:** Keep `release-pr.yml` as the changeset version/tag engine and keep `release-action.yml` scoped to `@everr/action@*`. Change only the source desktop and CLI release workflow trigger so a changeset tag for `@everr/desktop-app` starts the existing combined desktop+CLI build, package, and deploy dispatch flow.

**Tech Stack:** GitHub Actions YAML, Changesets package tags, existing `everr-deploy` repository dispatch deployment.

---

## File Structure

- Modify: `.github/workflows/deploy-desktop-app.yml`
  - Responsibility: build signed macOS desktop artifacts, build Linux CLI arm64 and x86_64 artifacts, package one combined release artifact, and dispatch one `desktop-app-release` event to `everr-deploy`.
  - Change: replace the source `workflow_dispatch` trigger with a `push.tags` trigger for `@everr/desktop-app@*`.
- Read only: `.github/workflows/release-pr.yml`
  - Responsibility: changeset version PR and tag creation. Confirm it remains the changeset entry point.
- Read only: `.github/workflows/release-action.yml`
  - Responsibility: GitHub Action release. Confirm it remains triggered only by `@everr/action@*`.
- Read only: `/Users/guidodorsi/workspace/everr-deploy/.github/workflows/deploy-desktop-app.yml`
  - Responsibility: deploy an already-built artifact. Confirm its manual recovery trigger remains untouched.

Do not add tests for YAML files that only assert workflow text content.

## Task 1: Convert Desktop And CLI Source Release To Changeset Tag Trigger

**Files:**

- Modify: `.github/workflows/deploy-desktop-app.yml`
- Read: `.github/workflows/release-pr.yml`
- Read: `.github/workflows/release-action.yml`
- Read: `/Users/guidodorsi/workspace/everr-deploy/.github/workflows/deploy-desktop-app.yml`

- [ ] **Step 1: Confirm the current source workflow trigger**

Run:

```bash
sed -n '1,24p' .github/workflows/deploy-desktop-app.yml
```

Expected output includes this trigger block:

```yaml
on:
  workflow_dispatch:
```

- [ ] **Step 2: Replace the manual source trigger with the changeset package tag trigger**

Edit `.github/workflows/deploy-desktop-app.yml` so the trigger block becomes exactly:

```yaml
on:
  push:
    tags:
      - "@everr/desktop-app@*"
```

Do not change the build, package, attestation, artifact upload, or `desktop-app-release` dispatch jobs.

- [ ] **Step 3: Verify the source workflow no longer has a manual trigger**

Run:

```bash
sed -n '1,24p' .github/workflows/deploy-desktop-app.yml
```

Expected output includes:

```yaml
on:
  push:
    tags:
      - "@everr/desktop-app@*"
```

Run:

```bash
rg -n "workflow_dispatch" .github/workflows/deploy-desktop-app.yml
```

Expected result: no matches. `rg` exits with status `1` when there are no matches; that is the expected result.

- [ ] **Step 4: Verify the changeset and action release workflows are still scoped correctly**

Run:

```bash
sed -n '1,80p' .github/workflows/release-pr.yml
```

Expected output includes:

```yaml
on:
  push:
    branches: [main]
```

and:

```yaml
uses: changesets/action@v1
```

Run:

```bash
sed -n '1,24p' .github/workflows/release-action.yml
```

Expected output includes:

```yaml
on:
  push:
    tags:
      - "@everr/action@*"
```

- [ ] **Step 5: Verify the deploy repo manual recovery path remains available**

Run:

```bash
sed -n '1,32p' /Users/guidodorsi/workspace/everr-deploy/.github/workflows/deploy-desktop-app.yml
```

Expected output includes both:

```yaml
repository_dispatch:
  types: [desktop-app-release]
```

and:

```yaml
workflow_dispatch:
```

Do not edit the deploy repository for this task.

- [ ] **Step 6: Validate YAML parsing and whitespace**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(ARGV.fetch(0)); puts "ok"' .github/workflows/deploy-desktop-app.yml
```

Expected output:

```text
ok
```

Run:

```bash
git diff --check
```

Expected result: no output and exit status `0`.

- [ ] **Step 7: Commit the workflow trigger change**

Run:

```bash
git add .github/workflows/deploy-desktop-app.yml
git commit -m "Release desktop app from changeset tags"
```

Expected result: one commit containing only the trigger change in `.github/workflows/deploy-desktop-app.yml`.
