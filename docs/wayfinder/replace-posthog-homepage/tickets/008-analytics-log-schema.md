---
name: 008-analytics-log-schema
title: Decide the analytics event and identity schema as Logs
labels: [wayfinder:grilling]
status: closed
assignee: guido
blocked-by: [001-posthog-autocapture-parity, 002-posthog-identity-cookieless, 007-web-vitals-long-tasks]
---

## Question

How do autocaptured interactions, pageviews, web vitals, and long tasks map onto Everr log records: event names, attribute set, session and visitor identity in cookieless mode (and how the consented mode upgrades it), and what "person properties" become in this model? The outcome is the canonical event schema the SDK emits and the heatmap and SDK-shape tickets build on.

## Resolution

Every analytics signal is a plain OTel log record landing in the existing logs pipeline (otel_logs / app.logs, which already has a dedicated EventName column and string-map attributes). No new storage, no person store.

**Record conventions.** EventName carries the event name; Body stays empty (attributes carry everything); SeverityNumber is INFO (9). Attribute naming follows OTel semconv wherever a convention exists (session.id, user.id, user.*, url.full, url.path, user_agent.original, browser.web_vital.* per ticket 007) and the everr. prefix everywhere else.

**Event taxonomy** (split per interaction type, no umbrella autocapture event):

- browser.page_view: navigation type (hard vs history_change), SPA route changes via patched history API.
- browser.page_leave: previous-pageview duration plus scroll-depth attributes, delivered via sendBeacon on pagehide.
- browser.click, browser.change, browser.submit: autocaptured interactions.
- browser.rage_click, browser.dead_click: separate derived events, PostHog-style detection thresholds.
- browser.web_vital: as decided in ticket 007 (web-vitals v5 attribution build, OTel attribute names; LoAF data rides inside INP attribution, no standalone long-task event).

**Identity, cookieless mode (the homepage).** No visitor id at all: no cookies, no storage, no server-side daily-salted hash, nothing derived from IP or user agent. This is deliberately stronger than PostHog's cookieless (which hashes ip+ua server-side); it means unique-visitor counts are simply not a homepage metric and no salt infrastructure exists to operate or defend. A random session.id (semconv name) is generated per page load, held only in JS memory, carried across SPA navigations, gone on reload or tab close. Sessions are the top-level analytics unit; distinct sessions are the closest thing to a visitors metric. Reload fragmentation is accepted (docs/marketing visits are mostly single-load).

**Identity, consented mode (product SDK, post-consent).** The event schema is identical; consent fills in what cookieless leaves empty. A random persistent visitor.id (everr.visitor.id) in localStorage (a device id, never fingerprint-derived); session.id becomes durable with the standard 30-minute inactivity timeout, surviving reloads and tabs. Consent upgrade is a one-way door: revoking consent means deleting the stored ids, not downgrading in place.

**Person properties become attribute stamping.** identify(userId, traits) — consented mode only — stamps user.id (an opaque internal id per the existing sensitive-data telemetry rule) and flattened user.* trait attributes on every subsequent event. Profiles are a query-time construct (argMax latest-wins over events); pre-identify events stitch through visitor.id / session.id at query time. No retroactive merging, no set_once semantics, no server-side mutation, no cohort store. Cookieless mode has no identify at all.

**Context envelope** (full PostHog parity). ResourceAttributes: service.name for the site, SDK name/version, user_agent.original, screen size, timezone, browser language. LogAttributes on every event: session.id, everr.page_view.id (links events to their pageview), url.full and url.path, everr.referrer.url, and a random everr.event.id for dedup (the $insert_id analogue). Marketing attribution: all five utm_* params plus PostHog's full ad-click-id set stamped as everr.utm.* / everr.ad_id.*; they are only stamped when present in the landing URL, so they cost nothing on organic traffic.

**Click payload** (the contract the heatmap ticket builds on). Structured flat keys for direct ClickHouse querying: everr.element.tag, everr.element.text (capped ~256 chars, never input values), everr.element.selector (stable CSS path), everr.element.href when present; plus everr.element.chain, one compact serialized ancestor string for full-fidelity element matching across DOM changes; plus everr.click.x / everr.click.y in page pixels and viewport size on the event for positional bucketing. PostHog's privacy guardrails carry over verbatim: input values never captured, password and hidden fields excluded, credit-card and SSN shaped strings dropped, and an everr-no-capture opt-out class.
