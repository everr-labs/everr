# Changeset-Based Release Triggers

## Goal

Move source releases from manual workflow dispatches to changeset-driven package tags.

Changesets should be able to trigger releases for only these deliverables:

- `@everr/action`
- `@everr/desktop-app`, which includes the signed macOS desktop app and Linux CLI binaries

## Current State

`release-pr.yml` already runs on pushes to `main`. It uses `changesets/action` to open or update the version PR, then creates package tags when the version PR is merged.

`release-action.yml` already listens for `@everr/action@*` tags and publishes the GitHub Action mirror release.

`deploy-desktop-app.yml` in the source repo currently builds and releases the desktop app plus Linux CLI from `workflow_dispatch`. That manual trigger allows creating a source release outside the changeset flow.

`everr-deploy` receives a single `desktop-app-release` dispatch, downloads the combined artifact, verifies it, and uploads both desktop and Linux CLI files. Its manual deploy trigger is only a recovery path for redeploying an existing artifact.

## Design

Use changeset-created tags as the only source release trigger.

- Keep `release-pr.yml` as the changeset entry point.
- Keep `release-action.yml` triggered by `@everr/action@*`.
- Change the source desktop and CLI release workflow to trigger on `@everr/desktop-app@*`.
- Remove `workflow_dispatch` from the source desktop and CLI release workflow.
- Keep the existing single combined desktop and CLI artifact.
- Keep the existing single `desktop-app-release` dispatch to `everr-deploy`.
- Keep `workflow_dispatch` in `everr-deploy` because it redeploys an already-built artifact and does not create a new source release.

## Data Flow

1. A feature PR includes a changeset for `@everr/action`, `@everr/desktop-app`, or both.
2. After that PR merges to `main`, `release-pr.yml` opens or updates the version PR.
3. When the version PR merges, `changesets/action` creates package tags.
4. A `@everr/action@x.y.z` tag runs the action release workflow.
5. A `@everr/desktop-app@x.y.z` tag runs the desktop and CLI release workflow.
6. The desktop and CLI workflow builds the signed macOS desktop app, Linux CLI arm64 binary, and Linux CLI x86_64 binary.
7. The workflow packages those outputs into one release artifact and dispatches one `desktop-app-release` event to `everr-deploy`.
8. `everr-deploy` downloads the artifact, verifies it, and uploads the macOS desktop and Linux CLI files.

No package tag means no source release for that package.

## Recovery

If the generated version PR is wrong, fix the changeset or generated version PR before merging it.

If the action release fails, rerun the tag-triggered `@everr/action@*` workflow.

If the desktop and CLI source build fails, rerun the tag-triggered `@everr/desktop-app@*` workflow.

If deployment fails after a successful source build, use the existing `everr-deploy` manual workflow with the source repository, source run ID, source SHA, and artifact name.

There is no manual path to create a new desktop or CLI source release from an arbitrary commit.

## Verification

Implementation verification should inspect workflow triggers and run existing relevant checks for any touched package code.

Do not add tests for YAML files that only assert workflow text content.
