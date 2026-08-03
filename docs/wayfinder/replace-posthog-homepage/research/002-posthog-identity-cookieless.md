# PostHog identity model and cookieless_mode "always"

## Answer first

PostHog identity is built on a client-stored `distinct_id`. Anonymous visitors get a locally stored random ID, `identify()` merges that anonymous person into a durable identified person with a person profile, and person properties (`$set`, `$set_once`) live on that profile. Under `cookieless_mode: "always"` all of that is gone: nothing is stored in the browser, `identify()` is forbidden, and identity becomes a server-side hash `hash(team_id, daily_salt, ip_address, user_agent, hostname)` whose salt rotates and is deleted daily. The result: sessions and unique-user counts work within a single day, but cross-day stitching, person profiles, `identify()`, session replay, surveys, flag caching, and GeoIP all break. PostHog's privacy rationale is that the hash is irreversible and therefore "not considered Personal Data", but PostHog does not claim the mode removes GDPR consent obligations in general.

Sources for the summary: [cookieless tutorial](https://posthog.com/tutorials/cookieless-tracking), [identify docs](https://posthog.com/docs/product-analytics/identify), [person properties docs](https://posthog.com/docs/product-analytics/person-properties), [GDPR guide](https://posthog.com/docs/privacy/gdpr-compliance).

## The normal identity model (with cookies)

### distinct_id mechanics

- "When someone first visits your site or app, PostHog automatically assigns them an anonymous ID, stored locally, and captures their events anonymously." The stored ID persists across sessions (first-party cookie or localStorage). Source: https://posthog.com/docs/product-analytics/identify
- Every event carries a `distinct_id`. Backend SDKs have no anonymous session concept; you pass the same `distinct_id` used on the frontend so frontend and backend events land on the same person. Source: https://posthog.com/docs/product-analytics/identify
- The cookie is first-party only: "We don't track users across different sites... the same cookie works across subdomains". Source: https://posthog.com/tutorials/cookieless-tracking

### Person profiles vs anonymous events

- "The key difference between identified and anonymous events is that for identified events we create a person profile for the user, whereas for anonymous events we do not." Source: https://posthog.com/docs/data/anonymous-vs-identified-events
- Default config is `person_profiles: 'identified_only'`: anonymous events are captured without profiles until something upgrades the user (calling `identify`, `alias`, `group`, or a person-property setter). With `person_profiles: 'always'` every event creates a profile. Source: https://posthog.com/docs/data/anonymous-vs-identified-events
- Pricing lever: "Anonymous events can be up to 4x cheaper than identified ones". Anonymous events cannot use person properties or cohort filtering because there is no profile. Source: https://posthog.com/docs/data/anonymous-vs-identified-events
- "By default, only identified users have person profiles" and "when setting properties, a person profile is created if it doesn't already exist." Source: https://posthog.com/docs/product-analytics/person-properties

### Person properties: $set and $set_once

- "Using `set` replaces any property value that may have been set on a person profile. In contrast, `set_once` only sets the property if it has never been set before." Source: https://posthog.com/docs/product-analytics/person-properties (snippet text at https://github.com/PostHog/posthog.com/blob/master/contents/docs/getting-started/_snippets/user-properties-set-vs-set-once.mdx)
- `$set_once` is keyed on whether the property currently exists on the profile, not on event timestamps; out-of-order ingestion means "the first ingested event claims the key". Same source.
- Properties are set via the `properties` argument of `identify`, via `$set` / `$set_once` keys on any `capture` call, or via helpers like `posthog.setPersonProperties` (recommended because they "handle important side effects like switching to identified mode"). Sources: https://posthog.com/docs/product-analytics/identify and https://posthog.com/docs/product-analytics/person-properties
- Caveat: with `person_profiles: 'identified_only'`, adding `$set` to an anonymous event does not create a profile; you must use the identifying functions. Source: snippet above.
- Limits and defaults: person records cap at 512KB of properties; posthog-js auto-captures defaults (browser, OS, referrer, UTM, initial-touch variants) and GeoIP enrichment adds location properties. Source: https://posthog.com/docs/product-analytics/person-properties

### identify

- `identify(distinct_id)` ("usually something stable like a UID, their email, or their database ID") "merges the anonymous person into the identified person, linking the two IDs together. From then on, looking up by either ID surfaces the user's full event history, from before and after they logged in." Source: https://posthog.com/docs/product-analytics/identify
- Best practices: call it as soon as you know who the user is (login or signup), use unique strings, and call `reset()` on logout so the next visitor gets a fresh anonymous ID. Source: https://posthog.com/docs/product-analytics/identify
- Property conflicts on merge: "the surviving (identified) person's value takes precedence." Source: https://posthog.com/docs/product-analytics/identify

### alias and merges

- `alias` assigns an additional distinct ID to an existing person ("any events submitted using either frontend_id or backend_id will be associated with the same user"), typically to bridge frontend and backend ID schemes. Source: https://posthog.com/docs/product-analytics/identify
- Merge restrictions: an alias ID "cannot be associated with more than one distinct_id" and "must not have been previously used as the distinct_id argument of an identify() or alias() call". Escape hatch is the `$merge_dangerously` event, which is "irreversible and has no safeguards". Source: https://posthog.com/docs/product-analytics/identify

## Cookieless mode

### Configuration surface

- Two client modes: `cookieless_mode: "always"` (never store anything, never show a banner) and `cookieless_mode: "on_reject"` (no storage and no events until consent is answered; on rejection, fall back to the hash; `opt_in_capturing()` / `opt_out_capturing()` wire up the banner, `get_explicit_consent_status()` reports pending state). Source: https://posthog.com/tutorials/cookieless-tracking
- Server prerequisite: "Cookieless server hash mode" must be enabled in Project Settings > Web analytics, otherwise the hash is not computed. Source: https://posthog.com/tutorials/cookieless-tracking

### Identity without cookies: the server-side hash

- Under "always": "PostHog never stores data in cookies or local/session storage", "You cannot call identify(), as a distinct ID would be considered Personal Data under GDPR", and "PostHog will measure the number of users on your site using a privacy-preserving hash, calculated on PostHog's servers." Source: https://posthog.com/tutorials/cookieless-tracking
- The formula: `hash(team_id, daily_salt, ip_address, user_agent, hostname)`. "A hash is an irreversible function, and a salt is a random value that changes daily which we delete once that day's events have been processed." Source: https://posthog.com/tutorials/cookieless-tracking
- Implementation detail (source code): the client sends the sentinel `distinct_id` value `$posthog_cookieless`; ingestion replaces it with `cookieless` prefix + base64 of the hash. Day boundaries are computed in the event or team timezone, and the salt is kept long enough to absorb up to 72 hours of ingestion lag. Sources: https://github.com/PostHog/posthog/blob/master/rust/common/cookieless/src/constants.rs and https://github.com/PostHog/posthog/blob/master/nodejs/src/ingestion/common/cookieless/cookieless-manager.ts
- The server has two hash modes (source code): stateless ("This mode cannot support $identify and $alias events, and does not support session timeout. There is one session per day per user, regardless of any period of inactivity") and stateful, which uses Redis to store session state and an identify counter. Source: https://github.com/PostHog/posthog/blob/master/nodejs/src/ingestion/common/cookieless/cookieless-manager.ts

### Session continuity

- Normal sessions: same `$session_id` per user, browser, and device until "no activity for 30 minutes" or a 24 hour maximum. Source: https://posthog.com/docs/data/sessions
- Cookieless stateless mode: the session ID is a UUIDv7 derived from the timestamp and the hash; one session per user per day, no inactivity timeout. Cookieless stateful mode: the session ID is a UUIDv7 stored in Redis keyed by the hash, with a 30 minute inactivity window implemented server-side. Source: https://github.com/PostHog/posthog/blob/master/nodejs/src/ingestion/common/cookieless/cookieless-manager.ts
- The original design discussion acknowledges the tension: "as cookieless tracking is stateless, there's no way of rolling a new session only after 30 minutes of activity without adding additional state." Source: https://github.com/PostHog/posthog/issues/25117
- Net: within one day, same network, same browser, the visitor is one continuous person and gets session grouping. Nothing survives the daily salt rotation.

### What breaks (from PostHog's own limitations list)

All from https://posthog.com/tutorials/cookieless-tracking unless noted:

- Cross-visit stitching: "Users that do not give cookie consent appear as different people each day... This means high unique user counts beyond one day (like weekly or monthly unique users). Additionally, not being able to identify() users means that it is impossible to link together multiple devices or browsers from the same user."
- Hash collisions: "two different users could be counted as one user. The most likely scenario would be two users with the same IP address (e.g. in a corporate network) and the same user agent."
- Person properties: no `identify()` and no browser storage means no person profiles for these visitors; everything is anonymous events keyed on a day-scoped hash. (Person profiles require an identifying call or `$set` on an identified person, per https://posthog.com/docs/data/anonymous-vs-identified-events.)
- Session replay and surveys: "Both are disabled if the user has not given cookie consent. This is because both features rely on storing data in cookies/local storage."
- Feature flags: flags can still be evaluated (the flags endpoint resolves the sentinel to the same server-side hash, per https://github.com/PostHog/posthog/blob/master/rust/feature-flags/src/handler/cookieless.rs), but "there can be a delay between the page loading and things like feature flags being available to query (unless flags are bootstrapped)" because no cached values exist in browser storage. Flag stickiness is only as stable as the hash, so multivariate assignments reset daily.
- GeoIP and bot detection: "The IP address is stripped before these transformations run. This means location data isn't added to events and the world map in Web Analytics won't show data."
- In `on_reject` stateful mode an identify counter in Redis is appended to the hash so a user who logs in and out does not collide with their own pre-identify hash person. Source: https://github.com/PostHog/posthog/blob/master/nodejs/src/ingestion/common/cookieless/cookieless-manager.ts

### GDPR rationale

- The claim PostHog makes is narrow: "whilst the IP address and User Agent are Personal Data, the hash is not considered Personal Data because it is impossible to obtain any Personal Data from the hash", and the daily salt is deleted "once that day's events have been processed". The pitch is framed as "comply with privacy regulations at the expense of a less detailed data capture" and for people who "just hate cookie banners". Source: https://posthog.com/tutorials/cookieless-tracking
- The mode also avoids the ePrivacy trigger by never storing or reading anything on the terminal equipment ("PostHog never stores data in cookies or local/session storage"). Source: https://posthog.com/tutorials/cookieless-tracking
- Important nuance: PostHog's GDPR guide does not present cookieless as a blanket consent exemption. It says consent must be "freely given, specific, informed and unambiguous" and that "If you use PostHog with cookies on your website (for logged out users), you should also use a cookie banner". Cookieless is offered as the alternative path for those who want to avoid the banner, with the data-loss tradeoffs above. Source: https://posthog.com/docs/privacy/gdpr-compliance
- The internal design note is candid about the audience: "people would use this mode because they don't have cookie consent", hence guidance not to send PII in events under this mode. Source: https://github.com/PostHog/posthog/issues/25117

## Implications for a dual-mode (cookieless + consented) SDK

1. Identity must be an abstraction with two backends. PostHog's design shows the clean seam: the client emits a sentinel distinct ID (`$posthog_cookieless`) and the server owns identity resolution. A dual-mode SDK should similarly route all capture through one API and let a policy layer decide whether the ID comes from storage or from a server-side hash. Sources: https://github.com/PostHog/posthog/blob/master/rust/common/cookieless/src/constants.rs, https://posthog.com/tutorials/cookieless-tracking
2. The hash approach only defensibly avoids "Personal Data" status if the salt genuinely rotates and is deleted, and if `identify()` and PII-bearing properties are structurally blocked in cookieless mode, not just documented as forbidden. PostHog enforces this at ingestion (identify events are dropped in stateless mode). Sources: https://posthog.com/tutorials/cookieless-tracking, https://github.com/PostHog/posthog/blob/master/nodejs/src/ingestion/common/cookieless/cookieless-manager.ts
3. Expect and message the metric discontinuities: DAU is roughly right, WAU/MAU inflate (new hash daily), corporate NAT deflates uniques via collisions. Any homepage or docs comparison of "users" across modes needs this caveat. Source: https://posthog.com/tutorials/cookieless-tracking
4. Session semantics need server-side state if you want the standard 30 minute inactivity window; the stateless fallback is "one session per day". Budget for a Redis-like store keyed by hash with TTLs sized for ingestion lag, plus timezone-aware day boundaries. Sources: https://github.com/PostHog/posthog/blob/master/nodejs/src/ingestion/common/cookieless/cookieless-manager.ts, https://github.com/PostHog/posthog/issues/25117
5. Consent upgrade is the hard edge. PostHog's `on_reject` mode holds all events until consent is answered, and there is no mechanism to stitch a pre-consent hash person to a post-consent cookie person (the hash is deliberately unlinkable). A dual-mode SDK should treat consent as a one-way upgrade that starts a fresh durable identity, and use an identify-counter trick (as PostHog does) to avoid self-collision within the same day. Sources: https://posthog.com/tutorials/cookieless-tracking, https://github.com/PostHog/posthog/blob/master/nodejs/src/ingestion/common/cookieless/cookieless-manager.ts
6. Feature-dependent degradation should be explicit: in cookieless mode, replay, surveys, person properties, cohorting, and cross-device linkage are off; feature flags work but without client caching (bootstrap them server-side) and with daily stickiness reset. A dual-mode SDK should expose a capability matrix per mode rather than failing silently. Sources: https://posthog.com/tutorials/cookieless-tracking, https://github.com/PostHog/posthog/blob/master/rust/feature-flags/src/handler/cookieless.rs
7. Pricing and data-model leverage: PostHog already splits anonymous events (up to 4x cheaper, no profile) from identified events. A dual-mode SDK maps naturally onto that split: cookieless traffic is permanently in the cheap anonymous tier, consented traffic can opt into profiles. Source: https://posthog.com/docs/data/anonymous-vs-identified-events
