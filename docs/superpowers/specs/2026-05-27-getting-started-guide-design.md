# Getting Started Guide - Design

Date: 2026-05-27
Status: Spec approved, pending implementation plan

## Summary

Add a canonical end-user getting started guide for Everr at `packages/docs/content/docs/getting-started.mdx`. The page should be the first top-level docs entry and should walk a new user through setting up Everr for their own repository using the CLI-first path.

The guide's job is to reduce setup ambiguity. It should explain what Everr is, run the installer, complete `everr setup`, configure notification emails, install global agent skills, add OpenTelemetry for local and production telemetry, verify local telemetry, add the Everr GitHub Action for CI resource usage, and show advanced investigation examples.

Existing docs remain the deeper references. The getting started guide should link out to them instead of absorbing all command reference, telemetry reference, app reference, and test analytics detail.

## Goals

- Give end users one clear first-run path for setting up Everr on their own repository.
- Make `curl -fsSL https://everr.dev/install.sh | sh` the primary install step, with a note that it runs `everr setup` automatically in an interactive terminal.
- Explain notification emails in practical terms: they identify the user's own CI runs so Everr can notify them about failed runs that need attention.
- Tell users that notification emails can be changed later in the desktop app settings.
- Recommend global Everr skills installation for supported coding assistants.
- Include starter TypeScript and Rust OpenTelemetry setup paths that cover local development and production export.
- Show how to verify local telemetry through CLI status, a coding assistant, or the desktop app.
- Add Everr Action setup after local telemetry verification so CI resource usage appears next to CI runs.
- End with concrete advanced investigation examples that connect setup to value.

## Non-goals

- Do not replace the CLI command reference.
- Do not turn this into a full OpenTelemetry SDK manual.
- Do not provide framework-specific TypeScript tutorials for every web framework.
- Do not provide exhaustive Rust crate instrumentation examples.
- Do not move or delete existing `App`, `CLI`, `Sending Telemetry`, `GitHub Action`, or `Test Analytics` docs.
- Do not change product behavior or CLI behavior as part of this docs work.

## Placement

Create:

```text
packages/docs/content/docs/getting-started.mdx
```

Update:

```text
packages/docs/content/docs/meta.json
```

The new page should appear first in the top-level docs navigation, before `app`, `features`, `cli`, `sending-telemetry`, `github-action`, and `reference`.

The existing `packages/docs/content/docs/app/getting-started.mdx` page should remain in place for hosted dashboard-specific onboarding. The new page is broader and should link to that page where useful.

## Page Outline

### 1. What Everr Is

Open with short product positioning:

Everr makes observability easy for developers and coding agents. Users can set up and test telemetry locally with help from their coding assistant, then carry the same visibility into production and CI.

The emphasis should be ease of setup across local, production, and CI, not a generic "dashboard" pitch.

### 2. Install And Run Setup

Primary command:

```sh
curl -fsSL https://everr.dev/install.sh | sh
```

Explain briefly:

- The installer installs the `everr` CLI.
- In an interactive terminal, the installer runs `everr setup` automatically.
- If setup is interrupted or skipped, the user can run `everr setup` manually.

Call out current installer constraints from `packages/docs/public/install.sh`:

- macOS only.
- arm64 only.
- Installs into `~/.local/bin`.
- Users may need to add `~/.local/bin` to `PATH`.

### 3. Configure Notification Emails

Explain the setup prompt:

- Everr asks which emails belong to the user.
- Everr uses those emails to identify CI runs owned by that user.
- This lets Everr notify the user about failed runs that need their attention.
- The email list can be updated later in the desktop app settings.

Keep this concise and avoid internal implementation detail.

### 4. Install Agent Skills Globally

Recommend accepting the skills installation step during setup and installing skills globally so supported assistants can use Everr across projects.

If skipped, show:

```sh
everr skills install --all --global
```

Explain that Everr skills teach supported coding assistants how to:

- inspect CI runs, jobs, logs, and flaky test data;
- set up OpenTelemetry;
- query local or cloud telemetry during investigations.

### 5. Set Up OpenTelemetry

Introduce OpenTelemetry as the path for app and service telemetry. Split the section into TypeScript and Rust starter paths.

Both starters should show the same environment shape:

- In local development, start the local collector with `everr local start` and send telemetry to the local collector endpoint.
- In production, create an ingest key in the Everr dashboard and send telemetry to `https://ingest.everr.dev/` with bearer-token authentication.

The guide should link to `/docs/sending-telemetry` for the full ingest-key and collector-exporter reference.

#### TypeScript Starter

The TypeScript example should focus on automatic instrumentation for common Node.js apps. It should show:

- a service name;
- local vs production endpoint selection;
- authorization header setup when an ingest key is present;
- enough SDK initialization to make requests and child queries visible.

Keep it generic enough to apply to common TypeScript backends without becoming a framework-specific tutorial.

#### Rust Starter

The Rust example should show:

- a service name;
- local vs production endpoint selection;
- authorization header setup when an ingest key is present;
- a minimal tracer/provider setup.

Keep it starter-level and point deeper Rust specifics to OpenTelemetry crate docs or future Everr docs.

### 6. Verify Local Telemetry

After setup, tell users to run:

```sh
everr local status
```

If the collector is not running, tell them to start it:

```sh
everr local start
```

Then present two verification paths:

- Ask Claude or Codex, with global Everr skills installed, to check that local telemetry is working.
- Open the desktop app and inspect traces and logs.

The verification text should mention that the app needs to emit traffic before traces or logs appear.

### 7. Add Everr Action For CI Resource Usage

Place this after local telemetry verification. This is the final setup enhancement before investigation examples.

Include a compact GitHub Actions snippet based on the existing `packages/docs/content/docs/github-action/index.mdx` page:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: everr-labs/everr-action@v0
        with:
          check-run-id: ${{ job.check_run_id }}

      # ...the rest of your job
```

Explain that the action captures per-job runner resource usage and lets Everr show resource pressure next to CI runs. This supports wall-time and cost investigations.

Link to `/docs/github-action` for inputs, behavior, and failure modes.

### 8. Advanced Investigations

Close with examples that show why the setup matters:

- Use TypeScript auto-instrumentation to inspect requests and child queries.
- Find slow queries and optimize them.
- Check CI for flaky tests.
- Look for CI wall-time optimization opportunities.
- Use CI resource usage to identify cost-reduction opportunities.

This section should be example-driven, not exhaustive. It should link to:

- `/docs/cli`
- `/docs/cli/telemetry`
- `/docs/app/workflows`
- `/docs/test-analytics`
- `/docs/github-action`

## Writing Style

- Use direct setup language.
- Prefer short sections and command blocks over long conceptual paragraphs.
- Avoid overselling. The guide should sound practical and specific.
- Treat the coding assistant path as a normal workflow, not a novelty.
- Use "coding assistant" generally, then mention Claude and Codex only where the verification path needs examples.
- Keep all commands copyable.

## Error Handling And Troubleshooting

Include short callouts for:

- Unsupported installer platform or architecture: the current install script supports macOS arm64.
- `everr` not found after install: add `~/.local/bin` to `PATH`.
- Setup interruption: run `everr setup`.
- Skills skipped: run `everr skills install --all --global`.
- Collector stopped: run `everr local start`.
- No local telemetry visible: generate app traffic and confirm the app exports to the local collector.
- Production ingest failures: confirm the ingest key is present and sent as `Authorization: Bearer <key>`.

## Verification

Implementation verification should include:

```sh
pnpm --filter @everr/docs types:check
```

If the docs build or MDX pipeline requires generated files to change, inspect those changes before deciding whether they belong in the implementation commit.

## Open Decisions

None. The user approved the page structure, ordering, global skills command, notification email explanation, and Everr Action placement.
