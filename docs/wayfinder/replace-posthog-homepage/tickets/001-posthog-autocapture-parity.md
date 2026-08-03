---
name: 001-posthog-autocapture-parity
title: What exactly do PostHog autocapture and pageviews record?
labels: [wayfinder:research]
status: closed
assignee: research-subagent
blocked-by: []
---

## Question

The homepage uses posthog-js with autocapture defaults ("defaults: 2026-01-30") and no custom capture() calls. What events and properties does that configuration actually record: autocaptured interactions (clicks, inputs, form submits), pageviews, pageleaves, session properties, device and UTM properties? What does the 2026-01-30 defaults preset change? This defines the parity baseline the analytics schema ticket must cover.

Primary source: https://posthog.com/docs/product-analytics/autocapture and related posthog-js docs.

Findings: research/001-posthog-autocapture-parity.md

## Resolution

- Events recorded today: $pageview, $pageleave, $autocapture (click, change, submit on a, button, form, input, select, textarea, label, contenteditable), $rageclick (3 clicks within 30px and 1s gaps), $dead_click. Copy capture is opt-in and off here.
- $autocapture carries $event_type, $elements_chain (ancestor chain with tag_name, classes, safe attributes like href, nth_child and nth_of_type), $el_text (capped at 1024 chars), $external_click_url. Input values, passwords, and hidden fields are never captured; credit-card and SSN shaped strings are dropped; the ph-no-capture class is honored.
- Pageviews: the 2026-01-30 defaults preset sets capture_pageview to "history_change" (SPA pathname changes via a patched history API, with a navigation_type property). $pageview_id rides on all events; later pageviews and $pageleave carry previous-pageview duration and eight scroll depth properties; $pageleave is sent via sendBeacon on pagehide.
- Standard properties on every event: current url, host, pathname, referrer pair, all UTM parameters plus 13 ad click ids, browser, OS, device, UA, screen and viewport, timezone, lib and lib_version, $insert_id for dedup.
- Cookieless "always" on the wire: zero cookies or storage; the client sends distinct_id "$posthog_cookieless" with $device_id null; identity is the server-side daily-salted hash; no client session or window id (assigned at ingestion); replay, surveys, identify, and consent are disabled; daily identity resets inflate WAU and MAU.
- The 2026-01-30 preset does not change the autocapture schema versus older presets; it adds history_change pageviews, rageclick ignore lists, replay minimum duration, and localhost auto-flagging as internal or test users.

The findings doc ends with a concrete parity checklist for the replacement SDK. Full detail: research/001-posthog-autocapture-parity.md
