# Channel test button: minor findings left open

From the task-by-task and whole-feature reviews of the draft channel test
(commits `1a81d031..3ebf5728`, `POST /v1/channel-tests` plus the Send test button
in `ChannelBuilder`).

Everything Critical and Important from those reviews was fixed before the branch
was called done. What follows is what was deliberately left, with the reasoning,
so a later reader can tell "considered and parked" from "never noticed".

## UI

### A success verdict may never be announced to a screen reader
`packages/app/src/components/cc/channel-builder.tsx` renders the result line with
`role={testResult.ok ? "status" : "alert"}`, and the element is inserted into the
DOM at the same moment its text appears. A polite live region that appears
together with its content is unreliably announced, notably on VoiceOver with
Safari. The assertive `role="alert"` failure path is fine, so today a screen
reader user hears "not delivered" but may hear nothing at all on success, which
is the worse asymmetry: silence reads as "nothing happened".

Fix: render an empty live region persistently and change its text, rather than
mounting the region and the text together.

### A stale verdict stays on screen during a re-test
Pressing Send test a second time does not route through `patch()`, which is what
clears `testResult`. So the previous "Delivered in 52ms" sits next to a button
reading "Sending...", describing the previous run. It is corrected the moment the
new result lands, so the window is short, but it is the same class of confusion
the config-change guard exists to prevent.

Fix: clear `testResult` in the mutation's `onMutate`.

### The destination note and the verdict can both be off screen
The spec asked for the destination address on the button itself. It landed as a
note under the Recipients field, which is better copy but a worse position: the
button lives in the drawer's fixed footer while the note and the result line live
in the scrolling body. On a short viewport a user can press a button in view and
have both the "sends to your own address" caveat and the verdict scrolled out of
sight. Worth a look at around 600px height before deciding whether it matters.

### A validation failure and a delivery failure look identical
A thrown `CcApiError` (422, for example an SSRF-rejected URL) and a delivered-but-
refused result (200 with `ok:false`) both render as `Not delivered: X` in the same
red tone. CC deliberately splits these into different HTTP outcomes so a client can
tell "your request was wrong" from "your channel is wrong" without parsing a body,
and the frontend re-merges them. In practice the message text usually discriminates
the two, so this is cosmetic rather than misleading.

### The email test gate asks for a value it then ignores
`draftToConfig` requires at least one recipient before an `email` config is
considered complete, so Send test stays disabled until the user types an address,
even though the server-side substitution discards it and mails the caller instead.
Pre-existing behavior reused from the Create path, not introduced here, but the
test button makes it briefly confusing.

## Engine

### `Event.name` on the synthetic notification has no reader
`crates/clickety-clack/src/api/test_notification.rs` sets
`n.events[0].name = "Channel test"`. No renderer touches `Event.name`: the Slack,
email and Telegram formatters all ignore it, and it surfaces only in the webhook
channel's serialized JSON body. That is probably the intent, but nothing says so
and no test asserts it, so it reads as a no-op to the next person.

Fix: one assertion, or one comment naming the webhook payload as its consumer.

### Every SMTP failure is classified transient
`crates/clickety-clack/src/dispatcher/email.rs` maps all lettre errors to
`NotifyError::Transient`, so a permanent 5xx renders as
`transient: permanent error (550): ...`. Pre-existing in the email notifier; the
test endpoint is simply the first surface that shows that string to a human.

### Two test modules in one file
`crates/clickety-clack/src/api/channels.rs` now has a `#[cfg(test)] mod
validate_tests` alongside the existing `mod tests`, with no stated boundary
between them. The three newer tests exercise the same functions as their
neighbours and belong in `mod tests`.

## Tests

### The five CC integration tests have never executed
`crates/clickety-clack/tests/it/api/channels_test_api.rs` reaches `fresh_db()`
through the `state()` helper even though none of the five tests touch Postgres.
That puts them in the `it` target, which declares
`required-features = ["container-tests"]` and runs only in CI. They have been
compiled but never run anywhere as of the branch being finished.

Risk is low and was assessed rather than assumed: each test is self-contained,
with a preset `FakeNotifier` outcome, no network, no timing and no ordering, and
`validate_webhook_url` is purely static. Moving them to the container-free
`unit_it` target would mean abstracting `AppState.store` away from the concrete
`PgStore`, which is not worth it for this change. They get their first real run
when the branch pushes.

### No test pins the 401 on this route
Nothing asserts `POST /v1/channel-tests` rejects a request with no
`X-CC-Tenant`. It is covered by construction, since the route sits behind the same
middleware layer and uses the same `tenant()` helper as its neighbours, and the
`api_key_auth` suite covers the gate on a representative route. A gap, not a hole.

### Nothing exercises the timeout branch
`TEST_SEND_TIMEOUT` is 8s and its elapsed arm returns `ok: false` with
`timed out after 8s`. No test drives it. Note this branch was dead code until the
whole-feature review caught that the app aborts every CC call at 10s, so a 30s
deadline could never be reached; it is live now, and untested.

## Out of scope, but load-bearing for this feature

### The relay guard is only as strong as email verification
The whole reason an email test mails the signed-in user rather than the typed
recipients is to stop Everr becoming an open relay. That guard rests on
`session.user.email` being an address the user actually controls. But
`packages/app/src/lib/auth.server.ts` enables `emailAndPassword` without
`requireEmailVerification`, so Better Auth's default of `false` applies: a
verification mail is sent on signup (`sendOnSignUp: true`) but signing in never
requires it, and the only related setting in the tree is
`requireEmailVerificationOnInvitation: false`.

So someone can self-register with an address they do not control and use the test
button to make Everr's relay mail it. The incremental exposure is close to nil,
because signup verification and password reset already send mail to unproven
addresses with the same reach, and the payload here is a fixed synthetic
notification rather than attacker-chosen text.

Recorded because the substitution should not be read as a stronger guarantee than
it is. It is the right design; it just inherits the strength of the signup policy.
This belongs to auth policy, not to the channel test.
