---
name: 002-posthog-identity-cookieless
title: How does PostHog's person and identity model work, and what survives cookieless?
labels: [wayfinder:research]
status: closed
assignee: research-subagent
blocked-by: []
---

## Question

How do PostHog person profiles and person properties work (identify, set, set_once, anonymous vs identified events), and which of those concepts survive under cookieless_mode "always"? What does PostHog use as the visitor identity when there are no cookies, and what are the known limits (session continuity, cross-visit stitching)? This informs the identity model for the cookieless homepage mode and the consented product mode.

Primary source: https://posthog.com/docs/product-analytics/person-properties and posthog-js cookieless docs.

Findings: research/002-posthog-identity-cookieless.md

## Resolution

- Normal model: a locally stored anonymous distinct_id; identify() merges the anonymous person into a durable person with a profile; $set overwrites, $set_once writes only if the key is absent (keyed on ingestion order, not timestamps); alias links a second id with strict merge restrictions. Anonymous events are up to 4x cheaper and have no person properties or cohorts.
- Cookieless "always": zero browser storage. The client sends a sentinel id and the server replaces it with hash(team_id, daily_salt, ip, user_agent, hostname). The salt rotates daily and is deleted after processing (kept at most 72h for ingestion lag).
- Session continuity: stateless mode gives one session per day (no 30-minute timeout); PostHog's stateful mode restores 30-minute sessions via Redis keyed on the hash. Nothing survives the daily salt rotation.
- What breaks: cross-day and cross-device stitching (WAU and MAU inflate), identify() (dropped at ingestion in stateless mode), person profiles and properties, session replay, surveys, and flag stickiness (resets daily). GeoIP is stripped.
- The GDPR rationale is narrow: the hash is argued to not be personal data because it is irreversible and the salt is deleted. PostHog markets it as banner-free but does not claim a blanket consent exemption.
- The findings doc closes with seven implications for a dual-mode SDK, including: keep a sentinel-id seam so the server owns cookieless identity, block PII structurally in cookieless mode, message the metric discontinuities, hold session state server-side, and make consent upgrade a one-way door.

Full detail: research/002-posthog-identity-cookieless.md
