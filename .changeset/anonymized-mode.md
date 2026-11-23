---
"@everr/otel-web": minor
---

Replace the `persistence` option with `anonymized`, which is `true` by default.

While `anonymized` is `true`, the SDK reads, writes and removes nothing in localStorage, sets no cookie, sends no `everr.visitor.id`, sends no `user.*` key from `identify()`, and sends a random `session.id` that lives in JS memory only and ends with the page. It does not change the resource attributes (user agent, screen size, time zone, language, landing URL), and it does not remove what you add through `setAttributes()`, per-record attributes or `beforeSend`. You decide whether your data needs a consent banner. With `anonymized: false`, the SDK keeps the visitor id and the session in localStorage and sends the `user.*` keys, as before.

`setAnonymized(next)` changes the mode on the live client. Leaving the mode keeps the current `session.id`, adds the visitor id and sends the user from an earlier `identify()`. Entering the mode sends the queued records, removes the stored ids and starts a new `session.id`. `clearIdentity()` forgets the user and the ids, and never changes the mode.

Migration:

- `persistence: "memory"` becomes nothing (the default) or `anonymized: true`. It now also drops the visitor id and the `user.*` keys.
- `persistence: "localStorage"`, or no `persistence` option, becomes `anonymized: false`. The default changed: with no option, the SDK is now anonymized.
- `setPersistence("localStorage")` becomes `setAnonymized(false)`, and `setPersistence("memory")` becomes `setAnonymized(true)`.
- `revoke()` becomes `setAnonymized(true)`, which removes the stored ids and stops sending the user. It no longer needs `clearIdentity()` before it. Call `clearIdentity()` on logout to forget the user.
- The `Persistence` type is removed.
- In a custom instrumentation, `ctx.ids().visitorId` is `undefined` while the SDK is anonymized.

The built-in Product analytics dashboard counts a session without a visitor id as one visitor.
