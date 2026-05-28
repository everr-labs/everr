# Getting Started Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level CLI-first getting started guide that helps end users set up Everr for their own repositories, local telemetry, production telemetry, agent skills, and CI resource usage.

**Architecture:** This is a docs-only change in the Fumadocs/TanStack Start docs package. Add one MDX page, register it first in the current docs navigation, and add a docs landing-card entry so new users find it before deeper references.

**Tech Stack:** Fumadocs MDX content, `packages/docs/content/docs/meta.json`, `pnpm --filter @everr/docs types:check`.

---

## File Structure

- Create `packages/docs/content/docs/getting-started.mdx`
  - Owns the canonical end-user onboarding flow.
  - Uses existing docs MDX conventions: frontmatter, headings, fenced commands, `Callout`, `Cards`, and `Card`.
- Modify `packages/docs/content/docs/meta.json`
  - Adds `getting-started` as the first top-level page.
- Modify `packages/docs/content/docs/index.mdx`
  - Adds a "Getting Started" card before the existing CLI, Sending Telemetry, and GitHub Action cards.
- Keep existing focused pages in place:
  - `packages/docs/content/docs/cli/index.mdx`
  - `packages/docs/content/docs/cli/telemetry.mdx`
  - `packages/docs/content/docs/sending-telemetry/index.mdx`
  - `packages/docs/content/docs/github-action/index.mdx`
  - `packages/docs/content/docs/test-analytics/index.mdx`

## External References Checked

- OpenTelemetry JavaScript Node.js getting started: `https://opentelemetry.io/docs/languages/js/getting-started/nodejs/`
- OpenTelemetry JavaScript exporters: `https://opentelemetry.io/docs/languages/js/exporters/`
- OpenTelemetry OTLP exporter configuration: `https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/`
- Rust `opentelemetry-otlp` crate docs: `https://docs.rs/opentelemetry-otlp/latest/opentelemetry_otlp/`

### Task 1: Add The Getting Started Page

**Files:**
- Create: `packages/docs/content/docs/getting-started.mdx`

- [ ] **Step 1: Confirm the page does not exist yet**

Run:

```bash
test ! -f packages/docs/content/docs/getting-started.mdx
```

Expected: PASS with exit code `0`.

- [ ] **Step 2: Create the page**

Create `packages/docs/content/docs/getting-started.mdx` with this content:

````mdx
---
title: Getting Started
description: Set up Everr for your repo, local telemetry, production telemetry, and CI investigations.
---

Everr makes observability easy for developers and coding assistants. You can set up and test telemetry in your local environment with help from your assistant, then carry the same visibility into production and CI.

This guide starts with the CLI because the installer runs the setup wizard for you. By the end, Everr should know about your repository, your assistant should know how to use Everr, your app should emit local and production telemetry, and your CI should report resource usage.

## Install Everr

Run the installer from a terminal:

```sh
curl -fsSL https://everr.dev/install.sh | sh
```

The installer adds the `everr` CLI and runs `everr setup` automatically when the terminal is interactive. The setup wizard signs you in, connects your organization, imports repositories, configures notification emails, offers agent skills, and can install the desktop app.

If setup is interrupted, run it again:

```sh
everr setup
```

<Callout title="Installer support">
  The installer currently supports macOS on arm64 and installs `everr` into
  `~/.local/bin`. If your shell cannot find `everr` after installation, add
  `~/.local/bin` to your `PATH`.
</Callout>

## Configure Notification Emails

During setup, Everr asks which email addresses belong to you. Everr uses those addresses to identify your CI runs and notify you when one of your runs fails or needs attention.

You can update the email list later from the desktop app settings.

## Install Agent Skills

Accept the skills step during setup and install the skills globally. Global skills let supported coding assistants use Everr across projects.

If you skipped that step, install them with:

```sh
everr skills install --all --global
```

Everr skills teach assistants how to inspect CI runs, jobs, logs, and flaky test data; set up OpenTelemetry; and query local or cloud telemetry during investigations.

## Set Up OpenTelemetry

Everr accepts standard OpenTelemetry data. In development, send telemetry to the local collector. In production, send telemetry to Everr's ingest endpoint with an ingest key.

Start the local collector before running an instrumented app:

```sh
everr local start
```

Keep that command running while you test locally. In another terminal, get the local OTLP endpoint:

```sh
everr local endpoint
```

For production, create an ingest key in the Everr dashboard from **Ingest Keys**. Store the full key in your secret manager; it is only shown once.

### TypeScript

Install the OpenTelemetry SDK, the Node auto-instrumentation package, and the OTLP HTTP/protobuf trace exporter:

```sh
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-proto
```

Create `instrumentation.ts`:

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

function otlpBaseUrl() {
  if (process.env.EVERR_INGEST_KEY) {
    return "https://ingest.everr.dev";
  }

  return process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:54318";
}

const endpoint = otlpBaseUrl().replace(/\/$/, "");
const headers = process.env.EVERR_INGEST_KEY
  ? { Authorization: `Bearer ${process.env.EVERR_INGEST_KEY}` }
  : {};

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    headers,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

Run locally:

```sh
export OTEL_SERVICE_NAME=my-typescript-service
export OTEL_EXPORTER_OTLP_ENDPOINT="$(everr local endpoint)"
npx tsx --import ./instrumentation.ts src/server.ts
```

Run in production:

```sh
export OTEL_SERVICE_NAME=my-typescript-service
export EVERR_INGEST_KEY="<your-ingest-key>"
node --import ./dist/instrumentation.mjs dist/server.mjs
```

The auto-instrumentation package creates spans for supported HTTP frameworks, database clients, and other common Node.js libraries. If a library is not covered, add manual spans around the code you need to investigate.

### Rust

Add OpenTelemetry and tracing dependencies:

```sh
cargo add opentelemetry opentelemetry_sdk tracing tracing-subscriber tracing-opentelemetry
cargo add opentelemetry-otlp --features trace,http-proto,reqwest-blocking-client
```

Add a telemetry initializer:

```rust
use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{Protocol, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::{trace::SdkTracerProvider, Resource};
use std::collections::HashMap;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn init_telemetry() -> Result<SdkTracerProvider, Box<dyn std::error::Error + Send + Sync>> {
    let service_name = std::env::var("OTEL_SERVICE_NAME")
        .unwrap_or_else(|_| "my-rust-service".to_string());
    let base_endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://127.0.0.1:54318".to_string());
    let trace_endpoint = format!("{}/v1/traces", base_endpoint.trim_end_matches('/'));

    let mut headers = HashMap::new();
    if let Ok(key) = std::env::var("EVERR_INGEST_KEY") {
        headers.insert("Authorization".to_string(), format!("Bearer {key}"));
    }

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(trace_endpoint)
        .with_headers(headers)
        .build()?;

    let resource = Resource::builder()
        .with_service_name(service_name.clone())
        .build();

    let provider = SdkTracerProvider::builder()
        .with_resource(resource)
        .with_batch_exporter(exporter)
        .build();

    let tracer = provider.tracer(service_name);
    let telemetry_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    tracing_subscriber::registry()
        .with(telemetry_layer)
        .init();

    global::set_tracer_provider(provider.clone());
    Ok(provider)
}
```

Call it when your application starts:

```rust
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let provider = init_telemetry()?;

    let span = tracing::info_span!("startup");
    let _guard = span.enter();
    tracing::info!("service started");

    provider.shutdown()?;
    Ok(())
}
```

Run locally:

```sh
export OTEL_SERVICE_NAME=my-rust-service
export OTEL_EXPORTER_OTLP_ENDPOINT="$(everr local endpoint)"
cargo run
```

Run in production:

```sh
export OTEL_SERVICE_NAME=my-rust-service
export OTEL_EXPORTER_OTLP_ENDPOINT="https://ingest.everr.dev"
export EVERR_INGEST_KEY="<your-ingest-key>"
cargo run --release
```

For production services, keep the provider alive for the lifetime of the process and shut it down during graceful shutdown.

For more collector and ingest-key details, see [Sending Telemetry](/docs/sending-telemetry).

## Verify Local Telemetry

Check that the local collector is reachable:

```sh
everr local status
```

If it is stopped, start it:

```sh
everr local start
```

Generate traffic against your local app, then verify with one of these paths:

- Ask Claude or Codex, with the global Everr skills installed, to check that local telemetry is working.
- Open the desktop app and inspect traces and logs.
- Query recent traces from the CLI:

```sh
everr local query "SELECT Timestamp, ServiceName, SpanName FROM otel_traces ORDER BY Timestamp DESC LIMIT 20"
```

To generate local logs from a command, run it through `everr wrap` while the collector is running:

```sh
everr wrap -- npm test
```

If nothing appears, make sure the app emitted traffic after instrumentation started and that it exports to the endpoint printed by `everr local endpoint`.

## Add CI Resource Usage

After local telemetry is working, add the Everr GitHub Action to jobs whose resource usage you want to track.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: everr-labs/everr-action@v0
        with:
          check-run-id: ${{ job.check_run_id }}

      - run: npm test
```

The action captures per-job CPU, memory, disk, and network usage, then Everr stitches those samples onto the matching CI run. That makes resource pressure visible next to failures, wall time, and cost.

For inputs and failure behavior, see [GitHub Action](/docs/github-action).

## Try Advanced Investigations

Once setup is complete, Everr can help answer questions that usually require switching tools:

- Use TypeScript auto-instrumentation to follow a request through child database queries.
- Find slow queries in local or production traces and optimize the code path.
- Check CI for flaky tests and recurring failure patterns.
- Look for workflows with high wall time and low signal.
- Use CI resource usage to find jobs that are expensive because they are CPU, memory, disk, or network constrained.

Good next references:

<Cards>
  <Card title="CLI" href="/docs/cli" description="Inspect CI and telemetry from the terminal" />
  <Card title="Local Telemetry" href="/docs/cli/telemetry" description="Start, query, and wrap commands with the local collector" />
  <Card title="Sending Telemetry" href="/docs/sending-telemetry" description="Send OpenTelemetry data to Everr" />
  <Card title="Test Analytics" href="/docs/test-analytics" description="Track flaky tests and test duration trends" />
  <Card title="GitHub Action" href="/docs/github-action" description="Capture per-job CI resource usage" />
</Cards>
````

- [ ] **Step 3: Confirm required sections and commands are present**

Run:

```bash
rg -n "curl -fsSL https://everr.dev/install.sh|everr setup|everr skills install --all --global|everr local status|everr-labs/everr-action@v0|TypeScript|Rust" packages/docs/content/docs/getting-started.mdx
```

Expected: PASS with matches for every pattern.

### Task 2: Register The Page In Docs Navigation

**Files:**
- Modify: `packages/docs/content/docs/meta.json`
- Modify: `packages/docs/content/docs/index.mdx`

- [ ] **Step 1: Update top-level docs metadata**

Replace `packages/docs/content/docs/meta.json` with:

```json
{
  "pages": ["getting-started", "cli", "sending-telemetry", "github-action"]
}
```

- [ ] **Step 2: Add a docs landing card**

Update the `<Cards>` block in `packages/docs/content/docs/index.mdx` so it starts with:

```mdx
<Cards>
  <Card title="Getting Started" href="/docs/getting-started" description="Set up Everr for your repo, local telemetry, production telemetry, and CI" />
  <Card title="CLI" href="/docs/cli" description="Use Everr from the terminal for CI observability workflows" />
  <Card title="Sending Telemetry" href="/docs/sending-telemetry" description="Send OpenTelemetry data to Everr" />
  <Card title="GitHub Action" href="/docs/github-action" description="Collect CI telemetry from GitHub Actions workflows" />
</Cards>
```

- [ ] **Step 3: Confirm the navigation files reference the new page**

Run:

```bash
rg -n "getting-started|Getting Started" packages/docs/content/docs/meta.json packages/docs/content/docs/index.mdx
```

Expected: PASS with matches in both files.

### Task 3: Verify Docs Build Inputs

**Files:**
- Read: `packages/docs/content/docs/getting-started.mdx`
- Read: `packages/docs/content/docs/meta.json`
- Read: `packages/docs/content/docs/index.mdx`

- [ ] **Step 1: Run the docs MDX/type pipeline**

Run:

```bash
pnpm --filter @everr/docs types:check
```

Expected: PASS with `fumadocs-mdx` and `tsc --noEmit` completing successfully.

- [ ] **Step 2: Inspect git diff**

Run:

```bash
git diff -- packages/docs/content/docs/getting-started.mdx packages/docs/content/docs/meta.json packages/docs/content/docs/index.mdx
```

Expected: Diff contains only the new getting started page, the meta page insertion, and the landing card insertion.

- [ ] **Step 3: Check worktree status**

Run:

```bash
git status --short
```

Expected: The plan file and new getting started page are present, and `index.mdx` / `meta.json` include the new page without reintroducing `/docs/app`, `/docs/features`, or `/docs/reference` links. Pre-existing docs deletions may still appear in `git status`; do not revert or stage them.

### Task 4: Leave The Implementation Uncommitted In The Dirty Worktree

**Files:**
- Read: `docs/superpowers/plans/2026-05-28-getting-started-guide.md`
- Read: `packages/docs/content/docs/getting-started.mdx`
- Read: `packages/docs/content/docs/meta.json`
- Read: `packages/docs/content/docs/index.mdx`

- [ ] **Step 1: Confirm the implementation files are unstaged**

Run:

```bash
git diff --cached --stat
```

Expected: No staged diff, because staging `index.mdx` or `meta.json` would also stage pre-existing user changes in those files.

- [ ] **Step 2: Report the dirty worktree clearly**

Run:

```bash
git status --short
```

Expected: The final response explains that the guide is implemented and verified, but not committed because the worktree already contains unrelated docs deletions and edits.
