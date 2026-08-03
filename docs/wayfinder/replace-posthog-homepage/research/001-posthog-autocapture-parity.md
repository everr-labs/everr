# What posthog-js records with `defaults: "2026-01-30"` and `cookieless_mode: "always"` (no custom capture calls)

Short answer: this setup records five event families automatically: `$pageview`, `$pageleave`, `$autocapture` (clicks, input changes, form submits on interactive elements), `$rageclick`, and `$dead_click`. Every event carries a large standard property set (browser, OS, device type, URL, referrer, UTM and click IDs, viewport, timezone, library version). Because of `cookieless_mode: "always"`, no cookies or storage are used: the client sends the sentinel `distinct_id: "$posthog_cookieless"`, `$device_id: null`, and `$cookieless_mode: true`, and PostHog's servers assign identity (a daily salted hash of team id, IP, user agent, and hostname) plus the `$session_id` at ingestion. The `2026-01-30` preset changes pageview capture to SPA-aware `"history_change"` mode, activates the rage click content ignore list, injects external scripts into `<head>`, and auto-marks localhost traffic as internal/test users. It does not change what autocapture records.

Sources are cited inline. Source code claims were verified against the posthog-js repo at `main` (read 2026-07-21); the dated preset semantics are frozen by design, so `main` accurately describes the `2026-01-30` behavior.

## 1. Autocaptured interactions

Autocapture is on by default (`autocapture: true`) and is independent of pageview capture ([config docs](https://posthog.com/docs/libraries/js/config)). The SDK attaches document-level capture-phase listeners for exactly three DOM event types: `submit`, `change`, and `click` ([autocapture.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts)). Interactions are captured for these elements: `a`, `button`, `form`, `input`, `select`, `textarea`, `label`, plus elements with `contenteditable="true"` ([autocapture docs](https://posthog.com/docs/product-analytics/autocapture)).

Resulting events:

- `$autocapture` with `$event_type: "click" | "change" | "submit"` and `$ce_version: 1` ([autocapture.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts)).
- `$rageclick`: emitted when 3 clicks land within 30 px of each other with less than 1000 ms between clicks (defaults `DEFAULT_CLICK_COUNT = 3`, `DEFAULT_THRESHOLD_PX = 30`, `DEFAULT_TIMEOUT_MS = 1000` in [rageclick.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/extensions/rageclick.ts)). `rageclick` config defaults to `true` ([config docs](https://posthog.com/docs/libraries/js/config)).
- `$dead_click` (and `$dead_swipe` on touch): clicks that do not lead to any page reaction; `capture_dead_clicks` defaults to `true` ([config docs](https://posthog.com/docs/libraries/js/config), [dead-clicks-autocapture.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/entrypoints/dead-clicks-autocapture.ts)). Dead click events carry `$dead_click_*` prefixed diagnostic properties.
- Copy/cut capture (`$copy_autocapture` with `$copy_type`) exists but is opt-in via `capture_copied_text` (default `false`), so it is NOT recorded in this setup ([autocapture docs](https://posthog.com/docs/product-analytics/autocapture), [autocapture.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts)).
- Heatmap data (`$$heatmap` batched coordinates) is also collected by default alongside autocapture ([autocapture docs](https://posthog.com/docs/product-analytics/autocapture)).

## 2. `$autocapture` event property set

Built in [autocapture.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts) and [autocapture-utils.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser-common/src/utils/autocapture-utils.ts):

- `$event_type`: `"click"`, `"change"`, or `"submit"`.
- `$ce_version: 1`.
- `$elements_chain`: a serialized string of the target element and all its ancestors. This is the canonical payload (the legacy `$elements` array of objects is deprecated and no longer sent by default; only `$elements_chain` is always sent).
- Per element in the chain: `tag_name`, `classes` (array), `attr__<name>` entries for each safe attribute (for example `attr__href`, `attr__class`, `attr__id`, `attr__data-*`, `attr__aria-label`), and position info `nth_child` and `nth_of_type`. Attribute values are truncated to 1024 chars.
- `$el_text`: text of the target element, truncated to 1024 chars. For `a` and `button` it uses direct plus nested-span text; otherwise "safe" text only.
- `$external_click_url`: present on clicks on links whose `href` points to another host.
- Plus all standard event properties from section 4 (the `$autocapture` event goes through the same property pipeline as every event).

Masking and privacy rules ([autocapture-utils.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser-common/src/utils/autocapture-utils.ts), [autocapture docs](https://posthog.com/docs/product-analytics/autocapture)):

- Free-form input values are never captured. Hidden and password inputs are always excluded.
- Any candidate text or attribute value matching credit card or SSN regexes is dropped (`shouldCaptureValue`).
- For "sensitive" elements (inputs and similar), only the `name`, `id`, `class`, and `aria-label` attributes are captured.
- Elements carrying the `ph-no-capture` or `ph-sensitive` CSS class are excluded entirely; `ph-no-capture` also suppresses dead click and rage click capture.
- Angular-style internal attributes are skipped; `element_attribute_ignorelist` can exclude more.

## 3. `$pageview` and `$pageleave`

With `defaults: "2026-01-30"`, `capture_pageview` resolves to `"history_change"`: an initial `$pageview` on load, then a `$pageview` on every SPA navigation via patched `history.pushState` / `history.replaceState` and a `popstate` listener, fired only when `location.pathname` actually changes ([config docs](https://posthog.com/docs/libraries/js/config), [history-autocapture.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/extensions/history-autocapture.ts)). History-driven pageviews carry a `navigation_type` property with value `"pushState"`, `"replaceState"`, or `"popstate"`.

`capture_pageleave` defaults to `"if_capture_pageview"`, so `$pageleave` is active here. It fires on `pagehide` (or `unload` fallback) and is sent via `sendBeacon` ([posthog-core.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/posthog-core.ts), [config docs](https://posthog.com/docs/libraries/js/config)).

Pageview-specific properties, from [page-view.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/page-view.ts):

- Every event gets `$pageview_id` (id of the current pageview) so events can be joined to the page they occurred on.
- Each `$pageview` after the first, and each `$pageleave`, additionally carries stats about the page being left: `$prev_pageview_id`, `$prev_pageview_pathname`, `$prev_pageview_duration` (seconds), and scroll depth metrics `$prev_pageview_last_scroll`, `$prev_pageview_last_scroll_percentage`, `$prev_pageview_max_scroll`, `$prev_pageview_max_scroll_percentage`, `$prev_pageview_last_content`, `$prev_pageview_last_content_percentage`, `$prev_pageview_max_content`, `$prev_pageview_max_content_percentage` (scroll tracking is on unless `disable_scroll_properties` is set).
- Both events also carry the full standard property set below ($current_url, referrer, UTM, and so on).

## 4. Standard properties on every event

Attached by the shared property pipeline ([event-utils.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser-common/src/utils/event-utils.ts), [posthog-core.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/posthog-core.ts), [default properties docs](https://posthog.com/docs/data/events)):

- Page: `$current_url`, `$host`, `$pathname`.
- Referrer: `$referrer`, `$referring_domain`, `$search_engine` (plus `$initial_*` set-once person variants when person processing applies).
- Campaign params, saved and attached from the URL: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, and ad click IDs `gclid`, `gad_source`, `gclsrc`, `dclid`, `wbraid`, `gbraid`, `fbclid`, `msclkid`, `twclid`, `li_fat_id`, `mc_cid`, `igshid`, `ttclid`.
- Device/browser: `$browser`, `$browser_version`, `$browser_language`, `$browser_language_prefix`, `$os`, `$os_version`, `$device`, `$device_type` (Desktop/Mobile/Tablet), `$raw_user_agent`.
- Screen: `$screen_height`, `$screen_width`, `$viewport_height`, `$viewport_width`.
- Library and bookkeeping: `$lib` (value `web`), `$lib_version`, `$insert_id` (dedup id), `$time` (epoch seconds), `$timezone`, `$timezone_offset`, `token`, `$config_defaults` (the literal `defaults` value, here `2026-01-30`), `distinct_id`, `$device_id`.
- Session: `$session_id` and `$window_id` are normally added client-side by the session manager, but NOT in this setup; see section 5.
- Server-side at ingestion, PostHog adds GeoIP properties and `$ip` for cookie-based traffic ([default properties docs](https://posthog.com/docs/data/events)).

## 5. What `cookieless_mode: "always"` changes

From [posthog-config.ts](https://github.com/PostHog/posthog-js/blob/main/packages/types/src/posthog-config.ts), [posthog-core.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/posthog-core.ts), [constants.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/constants.ts), and the [cookieless tracking tutorial](https://posthog.com/tutorials/cookieless-tracking):

- No cookies, no localStorage, no sessionStorage: persistence is fully disabled (`_is_persistence_disabled()` returns true for `"always"`).
- Identity: the client registers `distinct_id: "$posthog_cookieless"` (a sentinel, `COOKIELESS_SENTINEL_VALUE`) and `$device_id: null`. Every event carries `$cookieless_mode: true` telling the server to use cookieless hash mode.
- The server computes the real identity as `hash(team_id, daily_salt, ip_address, user_agent, hostname)`. The salt rotates daily and is deleted after processing, so the hash is not reversible to personal data ([tutorial](https://posthog.com/tutorials/cookieless-tracking)).
- Sessions: the client-side `SessionIdManager` is not constructed (it throws if used with `cookieless_mode: "always"`), so events leave the browser without `$session_id` / `$window_id`. PostHog ingestion assigns `$session_id` server-side when cookieless mode is enabled for the project ([posthog-config.ts](https://github.com/PostHog/posthog-js/blob/main/packages/types/src/posthog-config.ts), [sessionid.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/sessionid.ts)).
- Hard requirement: cookieless mode must also be enabled in the PostHog project settings, otherwise all cookieless events are ignored at ingestion ([posthog-config.ts](https://github.com/PostHog/posthog-js/blob/main/packages/types/src/posthog-config.ts)).
- Disabled or degraded: session replay is not started, surveys are unavailable, `identify()` with the sentinel is rejected, consent opt-in/opt-out calls are ignored, and feature flags cannot be cached. Users reappear as new people each day (daily salt rotation) which inflates weekly and monthly uniques, and hash collisions can merge distinct users on shared networks ([tutorial](https://posthog.com/tutorials/cookieless-tracking), [posthog-core.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/posthog-core.ts)).
- Autocapture, pageviews, pageleaves, rage clicks, dead clicks, and web vitals all still work in cookieless mode; only session-dependent and storage-dependent features are lost.

## 6. What the `2026-01-30` defaults preset changes

`defaults` is a versioned preset system; `"2026-01-30"` is a documented member of the `ConfigDefaults` union (`'2026-06-25' | '2026-05-30' | '2026-01-30' | '2025-11-30' | '2025-05-24' | 'unset'`) ([posthog-config.ts](https://github.com/PostHog/posthog-js/blob/main/packages/types/src/posthog-config.ts)). Presets are cumulative. Exact resolution from `configDefaults()` in [posthog-core.ts](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/posthog-core.ts) and the [config docs](https://posthog.com/docs/libraries/js/config):

| Preset | Change versus legacy (`unset`) |
| --- | --- |
| `2025-05-24` | `capture_pageview` becomes `"history_change"` (SPA navigation pageviews) instead of `true` (initial load only) |
| `2025-11-30` | plus `session_recording.strictMinimumDuration: true` and `rageclick: { content_ignorelist: true }` (suppresses rage clicks on navigation-style controls such as next, previous, and arrow labels) |
| `2026-01-30` | plus `external_scripts_inject_target: "head"` (avoids SSR hydration errors) and `internal_or_test_user_hostname` defaulting to a regex matching `localhost` or `127.0.0.1` (auto-flags `$internal_or_test_user: true` and enables person processing on matching hosts) |
| `2026-05-30` | plus `persistence_save_debounce_ms: 250`, `split_storage: true`, `detect_google_search_app: true`, expanded rage click ignore list and text-selection exclusion (not active in this setup) |
| `2026-06-25` | plus `session_recording.streamNetworkBody: true` and `disable_capture_url_hashes: true` (not active in this setup) |

Net effect for this setup: the preset does not change which interactions autocapture records or the `$autocapture` property schema. It changes pageview semantics (SPA-aware), rage click noise filtering, script injection placement, and internal-user flagging on localhost. Note the localhost consequence: events sent from local dev are tagged `$internal_or_test_user: true` with person processing enabled, and can be filtered out in PostHog.

## Parity checklist

A replacement SDK must record the following to match this PostHog setup:

Events

- [ ] `$pageview` on initial load and on every SPA pathname change (patched pushState/replaceState plus popstate), with `navigation_type` on history-driven views.
- [ ] `$pageleave` on pagehide/unload, delivered via `sendBeacon`.
- [ ] `$autocapture` for click, change, and submit on `a`, `button`, `form`, `input`, `select`, `textarea`, `label`, and contenteditable elements.
- [ ] `$rageclick` (3 clicks within 30 px within 1 s per click gap), suppressing navigation-style control text per the content ignore list.
- [ ] `$dead_click` for clicks that produce no page reaction.

Autocapture payload

- [ ] `$event_type`, `$elements_chain` (full ancestor chain string), `$el_text` (1024 char cap), `$external_click_url` for outbound link clicks.
- [ ] Per element: `tag_name`, `classes`, `attr__href` and other safe attributes (1024 char cap), `nth_child`, `nth_of_type`.
- [ ] Masking: never capture input values, passwords, or hidden fields; drop credit card and SSN shaped strings; honor `ph-no-capture`; restrict sensitive elements to name/id/class/aria-label attributes.

Pageview payload

- [ ] `$pageview_id` on all events; `$prev_pageview_id`, `$prev_pageview_pathname`, `$prev_pageview_duration`, and the eight `$prev_pageview_*scroll*` / `*content*` scroll depth properties on subsequent pageviews and on `$pageleave`.

Standard properties on every event

- [ ] `$current_url`, `$host`, `$pathname`, `$referrer`, `$referring_domain`, `$search_engine`.
- [ ] UTM params (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) and ad click IDs (`gclid`, `fbclid`, `msclkid`, `ttclid`, `twclid`, `li_fat_id`, `wbraid`, `gbraid`, `gad_source`, `gclsrc`, `dclid`, `mc_cid`, `igshid`).
- [ ] `$browser`, `$browser_version`, `$browser_language`, `$os`, `$os_version`, `$device_type`, `$raw_user_agent`.
- [ ] `$screen_height`, `$screen_width`, `$viewport_height`, `$viewport_width`, `$timezone`, `$timezone_offset`.
- [ ] `$lib`, `$lib_version`, `$insert_id` (dedup), event timestamp.

Cookieless identity semantics

- [ ] No cookies, localStorage, or sessionStorage of any kind.
- [ ] Anonymous identity derived server-side (daily salted hash of IP, user agent, and host), never persisted client-side; accept day-boundary identity resets.
- [ ] Sessionization performed server-side (no client session id), or an equivalent privacy-preserving session assignment.
- [ ] Internal/test traffic flagging for localhost (`$internal_or_test_user` equivalent) so dev traffic is excludable.

## Primary sources

- https://posthog.com/docs/product-analytics/autocapture
- https://posthog.com/docs/libraries/js/config
- https://posthog.com/docs/data/events
- https://posthog.com/tutorials/cookieless-tracking
- https://github.com/PostHog/posthog-js (files: `packages/browser/src/posthog-core.ts`, `packages/browser/src/autocapture.ts`, `packages/browser/src/page-view.ts`, `packages/browser/src/extensions/history-autocapture.ts`, `packages/browser/src/extensions/rageclick.ts`, `packages/browser/src/entrypoints/dead-clicks-autocapture.ts`, `packages/browser/src/sessionid.ts`, `packages/browser/src/constants.ts`, `packages/browser-common/src/utils/event-utils.ts`, `packages/browser-common/src/utils/autocapture-utils.ts`, `packages/types/src/posthog-config.ts`)
