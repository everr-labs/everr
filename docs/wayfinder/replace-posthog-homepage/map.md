---
name: replace-posthog-homepage
title: Replace PostHog on the homepage with Everr-native telemetry
labels: [wayfinder:map]
status: closed
---

# Replace PostHog on the homepage with Everr-native telemetry

## Destination

A handoff-ready spec for an Everr-native browser telemetry SDK that replaces PostHog: analytics, structured errors, web vitals and long tasks, session replay, click heatmap, and browser profiling. The homepage (packages/docs) is the first dogfooding deployment and runs in strict cookieless mode. The productized SDK may offer a consented mode with a cookie banner.

## Notes

- Planning only: tickets resolve decisions, the spec is the only deliverable. No homepage code changes inside this map.
- Privacy: cookieless with no consent banner is a hard constraint for the homepage deployment. The product SDK is dual-mode (cookieless and consented).
- Philosophy: users should not have to worry about pricing. Weigh volume and storage decisions accordingly.
- Capability mapping sketch from the original notes: analytics, errors, long tasks, and web vitals map to Logs; rrweb replay maps to a ClickHouse table; profiling maps to pprof.
- Current state: PostHog lives only in packages/docs (posthog-js init in src/lib/posthog.ts with cookieless_mode "always", PostHogProvider in __root.tsx). No custom capture() calls anywhere, so parity means autocapture plus pageviews, cookieless.
- Skills to consult: everr-setup-telemetry (ingestion), clickhouse-best-practices (any table schema), grilling and domain-modeling (HITL tickets), dataviz (heatmap visualization).
- Existing groundwork: packages/auto-otel-errors and the web-error-tracking worktree (.claude/worktrees/web-error-tracking).

### Tracker conventions (local markdown)

- Tickets live in tickets/, one file each. Research assets live in research/.
- Claim a ticket by setting assignee in its frontmatter before working it.
- Close a ticket by setting status: closed and appending a "## Resolution" section.
- Frontier: open, unassigned tickets whose blocked-by list only names closed tickets.

## Decisions so far

<!-- one line per closed ticket: gist plus link -->

- [What is the structured-errors approach, and what error groundwork already exists here?](tickets/003-structured-errors-groundwork.md): browser error capture is already shipped (auto-otel-errors plus browser ingest keys, merged from the web-error-tracking effort); grouping is a ClickHouse fingerprint UDF; no source maps anywhere; evlog adds stable error codes worth considering.
- [Can browser profiles be captured and converted to pprof, and at what cost?](tickets/006-browser-profiling-pprof.md): viable with caveats; JS Self-Profiling API is Chromium only (~76% coverage), needs a Document-Policy header, ~100Hz sampling at under 1% overhead, and the pprof mapping is clean with small glue via the pprof-format JS encoder. Minified frames need source maps to read.
- [How are web vitals and long tasks best captured, and what log shape should they have?](tickets/007-web-vitals-long-tasks.md): web-vitals v5 attribution build, flush on visibility hidden via sendBeacon; prefer LoAF over longtask (already embedded in INP attribution, skip a standalone observer); pin SPA vitals to the landing URL plus route pattern; adopt the OTel browser.web_vital attribute names.
- [How does PostHog's person and identity model work, and what survives cookieless?](tickets/002-posthog-identity-cookieless.md): cookieless means server-side hash(team_id, daily_salt, ip, ua, host) with zero browser storage; one session per day unless server-side session state exists; person properties, identify, replay, and cross-day stitching all break; the SDK should keep a sentinel-id seam and treat consent upgrade as a one-way door.
- [What is rrweb's event format and what would a ClickHouse storage schema look like?](tickets/005-rrweb-clickhouse-schema.md): full snapshot plus incremental deltas, compress whole sessions server-side (ZSTD codec, not packFn); candidate schema is replay_events MergeTree ordered by (tenant, session, time, seq) with a 30-day TTL plus an AggregatingMergeTree session summary; ~50 to 100 KB per session, so ClickHouse-only is fine at homepage scale, S3 offload only matters past ~100K sessions/month.
- [What does GDPR require for session replay, cookieless vs consented?](tickets/004-replay-gdpr.md): cookieless bannerless replay is not defensible for EU traffic (EDPB Guidelines 2/2023 plus Opinion 5/2019 plus the CNIL draft: replay always needs prior consent, the audience measurement exemption does not cover it); realistic options are no replay on the homepage, CMP-gated replay, or trigger-scoped consented capture; consented mode needs masking by default, sampling, short retention, per-session deletion.
- [What exactly do PostHog autocapture and pageviews record?](tickets/001-posthog-autocapture-parity.md): parity means $pageview and $pageleave (history_change SPA tracking, scroll depth, sendBeacon on pagehide), $autocapture with an elements chain and capped el_text (never input values), rageclick and dead click detection, and a standard property set (url, referrer, UTM plus ad click ids, device, viewport, $insert_id); the findings doc has the full parity checklist.
- [Decide the analytics event and identity schema as Logs](tickets/008-analytics-log-schema.md): plain OTel log records with per-interaction event names (browser.page_view, browser.click, ...), semconv attribute names plus everr.* extensions; cookieless has no visitor id at all (in-memory session.id only, sessions are the unit); consented mode adds localStorage visitor.id, 30-minute sessions, and identify() as attribute stamping (no person store); full-parity envelope and a structured click payload with coordinates for the heatmap.
- [Decide the error tracking approach for the homepage](tickets/009-error-tracking-approach.md): reuse @everr/auto-otel-errors/browser as-is (defaults plus router error boundary, global patching off), grouping via the errorFingerprint UDF, stacks stay minified (symbolication ruled out of scope for the map), and the SDK stamps the ticket 008 session envelope on all log records so errors correlate with analytics.
- [Decide session replay: does it run on the homepage, and how is it stored?](tickets/010-session-replay-decision.md): no replay on the homepage; replay is a consented-mode-only SDK capability (lazy-loaded after opt-in, dogfooded on the web app) with Sentry-grade mask-all defaults, 30-day TTL plus sampling and per-session deletion, the researched ClickHouse-only schema (replay_events plus replay_sessions) adopted as specced, and replay session_id equal to the analytics session.id.
- [Decide click heatmap capture and visualization](tickets/011-click-heatmap.md): not planned for now; capture stays the ticket 008 click payload as-is (no mousemove, no extra fields) so data accrues from day one, and any future clickmap is a separate effort (leaning: element-based aggregation over everr.element.selector rendered as dashboard panels).
- [Decide browser profiling scope](tickets/012-profiling-scope.md): cut entirely, no capture and no reserved SDK module slot; Everr has no profiling surface to land pprof in (net-new infrastructure, same category that ruled out symbolication), minified frames gut readability, and web vitals plus LoAF already cover homepage performance. Capture feasibility facts preserved in the ticket for a future effort.
- [Decide SDK packaging, ingestion path, and dual privacy modes](tickets/013-sdk-shape-ingestion.md): `@everr/web-sdk` at packages/web-sdk; analytics and errors ride the existing OTLP /v1/logs path with the public origin-bound browser key (no new endpoint), replay gets a dedicated /v1/replay route built only when consented mode ships; dual modes are a discriminated-union init returning mode-typed handles with replay a lazy subpath requiring the ConsentedClient, making cookieless-implies-no-replay structural; batch plus exit-flush over keepalive/beacon; 30KB gz core / 60KB gz replay CI-enforced budgets; docs adopts via a side-effect telemetry.ts mirroring the web app's client, no provider component.
- [Decide rollout and cutover mechanics for the homepage](tickets/015-rollout-cutover.md): parallel-run for ~2 weeks with both SDKs emitting, then a second PR removes PostHog; verification is one manual eyeball check by Guido (same order of magnitude pageviews, clicks/vitals/errors present), no parity bands or comparison dashboards since the data is write-only today; removal drops the deps, posthog.ts, provider, and VITE_POSTHOG_* env vars; the PostHog project is kept dormant, not deleted.
- [Assemble the handoff spec](tickets/014-assemble-spec.md): the spec lives at docs/specs/0002-everr-web-sdk.md, assembling all fourteen decisions with links back to tickets and research; Guido confirmed it ready for an implementation effort on 2026-07-22, closing the map.

## Not yet specified

- How this data surfaces in the Everr app: dashboards and the replay player (heatmap rendering settled as not planned).
- Sampling, volume, and cost controls for high-traffic deployments.
- Pricing and positioning implications of the no-pricing-worries philosophy.

## Out of scope

- Implementing the replacement on the homepage: a separate effort executes the spec.
- Shipping the SDK to external customers (product GA).
- Source map upload and symbolication: net-new server-side infrastructure, ruled out while resolving [Decide the error tracking approach for the homepage](tickets/009-error-tracking-approach.md); error stacks and profiler frames stay minified within this effort. A separate future effort if wanted.
- Heatmap visualization: ruled not planned while resolving [Decide click heatmap capture and visualization](tickets/011-click-heatmap.md); the SDK still captures the full click payload, but rendering a clickmap is a separate future effort.
- Browser profiling: cut entirely while resolving [Decide browser profiling scope](tickets/012-profiling-scope.md); needs a net-new pprof ingestion and viewing surface in Everr plus symbolication to be useful, so it is a separate future effort. Capture-side feasibility research stays linked from the ticket.
