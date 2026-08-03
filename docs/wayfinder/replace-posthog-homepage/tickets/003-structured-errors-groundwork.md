---
name: 003-structured-errors-groundwork
title: What is the structured-errors approach, and what error groundwork already exists here?
labels: [wayfinder:research]
status: closed
assignee: research-subagent
blocked-by: []
---

## Question

Two parts. First, what does the structured-errors approach at https://www.evlog.dev/learn/structured-errors propose (error shape, codes, context, grouping)? Second, what do the local packages/auto-otel-errors package and the web-error-tracking worktree (.claude/worktrees/web-error-tracking) already implement for capturing browser errors as telemetry? The error-tracking decision ticket needs both to choose an approach for the homepage.

Findings: research/003-structured-errors-groundwork.md

## Resolution

Most of the groundwork already exists and is shipped:

- evlog structured errors: a rich error object (message, code, status, why, fix, link, cause, internal) with stable machine-readable codes as the grouping key, catalogs via defineErrorCatalog(), and a user-facing vs internal context split.
- @everr/auto-otel-errors (v0.2.3) already captures uncaught exceptions, rejections, Express/Fastify/React errors, and manual captureError as OTel exception log events (exception.type/message/stacktrace, everr.error.handled/mechanism, log.record.uid), with redaction, rate limiting, and beforeSend.
- The web-error-tracking worktree branch is fully merged into main. It shipped browser error reporting for the web app: public browser ingest keys, collector CORS plus origin verification, router error component capture, and prod image key baking.
- Grouping is a ClickHouse errorFingerprint UDF (explicit error.fingerprint attribute wins, otherwise a hash of service, type, normalized message), shared by packages/telemetry-explorer/src/errors/sql/.
- No source map handling exists anywhere; production browser stacks stay minified.

Pragmatic default for the decision ticket: reuse the shipped pipeline, add evlog-style codes if stable grouping is needed, track symbolication separately. Full detail: research/003-structured-errors-groundwork.md
