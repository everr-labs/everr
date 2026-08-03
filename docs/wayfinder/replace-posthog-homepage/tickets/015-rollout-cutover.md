---
name: 015-rollout-cutover
title: Decide rollout and cutover mechanics for the homepage
labels: [wayfinder:grilling]
status: closed
assignee: guido
blocked-by: [013-sdk-shape-ingestion]
---

## Question

With the target shape fixed by [Decide SDK packaging, ingestion path, and dual privacy modes](013-sdk-shape-ingestion.md) (side-effect `telemetry.ts` module, cookieless init, PostHogProvider removed): how does the homepage get from PostHog to `@everr/web-sdk`? Decide whether there is a parallel-run window with both SDKs emitting (and for how long), what verification proves the Everr side is trustworthy before PostHog is removed (which metrics are compared, what counts as parity given cookieless sessions replace unique visitors), and the removal steps (posthog-js dependency, env vars, PostHog project teardown or retention).

## Resolution

**Parallel-run, two PRs.** PR 1 ships `@everr/web-sdk` on the homepage alongside PostHog; both emit simultaneously for roughly two weeks. PR 2 removes PostHog once verification passes. Rationale: verification is only meaningful on overlapping traffic, the SDKs do not interact, and rollback during the window is deleting one file.

**Verification is a single manual check by Guido, not a monitored criterion.** Homepage PostHog data is write-only today (no custom capture calls, no consumers), so formal parity bands would be ceremony. After a few days of overlap Guido eyeballs once: daily pageviews in Everr are the same order of magnitude as PostHog `$pageview`, and clicks, web vitals, and errors are present at all. No comparison dashboards get built. Explicitly not compared: unique visitors and session counts (definitionally incomparable under cookieless: PostHog uses a daily-salted server-side hash, Everr cookieless has in-memory sessions only) and rageclick/dead-click counts (heuristics differ).

**Removal inventory (PR 2):** drop `posthog-js` and `@posthog/react` from `packages/docs/package.json`; delete `src/lib/posthog.ts`; unwrap `PostHogProvider` in `__root.tsx`; remove the `VITE_POSTHOG_PROJECT_TOKEN` and `VITE_POSTHOG_HOST` entries from `env.ts`, `.env`, and `.env.example`; remove the same vars from the deployment environment config.

**The PostHog project is kept dormant, not deleted.** No teardown steps beyond the code removal.
