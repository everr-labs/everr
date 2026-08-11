# 45: A channel that will never accept the message stops trying

**What to build:** A send that cannot succeed on any retry fails on its first
attempt, for every channel type, not just for two of the four. Demo: point a
Slack channel at a revoked webhook URL and fire the rule. The delivery reaches
`failed` once, with one `delivery_failed` row, instead of posting to the dead
endpoint five times.

**Details:** found 2026-08-11, while moving the channel transports into
`data/alerting/delivery/providers/`. The move made the four channels
comparable for the first time and the odd pair out fell straight out of it.

`send-delivery.ts` decides whether a failure is worth retrying by the type of
what was thrown:

```ts
const permanent = cause instanceof ChannelSendError && cause.permanent;
```

`postJson` throws `ChannelSendError` and classifies the status
(`isPermanentStatus`: a 4xx other than 408 or 429 cannot be helped by
repeating the identical request). Webhook and Discord go through it, so they
stop on a 403.

Slack and Telegram never went through it. Both were written as standalone
helpers under `lib/`, both threw a plain `Error`, and a plain `Error` fails the
`instanceof` test, so `permanent` is false whatever the provider said. A
revoked Slack webhook and a chat that blocked the bot both burn all five
attempts of `ALERT_DELIVERY_MAX_ATTEMPTS`, spaced by Graphile's backoff, before
the delivery gives up. The same holds for a Telegram channel saved with an
empty bot token, which throws before any request is made and can obviously
never come good.

Nobody is paged wrongly by this and no history row is lost, which is why it
survived review: the cost is four wasted attempts against an endpoint already
known to be dead, and a delivery that sits in `failed` far longer than it
needs to before it is collected as terminal.

**The Telegram fan-out needs more than a type change.** One channel sends to
every chat id it holds, and today `Promise.all` surfaces whichever rejection
happens first. Classifying that verdict as the delivery's verdict would be a
regression: one chat that blocked the bot (permanent) racing one chat behind a
5xx (transient) would end the delivery on the first attempt, and the second
chat would never get the message a retry would have delivered. A fan-out is
only permanently failed when no retry could help any recipient, so the
per-recipient verdicts have to be collected and combined, not raced.

Not covered here: a retried fan-out still re-sends to recipients that already
succeeded. That is ticket 23, and this ticket must not be read as fixing it.
Nor does this change what an operator sees; it changes only how many times we
knock on a door that is not going to open.

**Blocked by:** None.

**Status:** done

- [x] Slack failures carry the provider's status into the retry decision
- [x] Telegram failures do the same, including the unconfigured-token case
- [x] A fan-out is permanent only when every recipient's failure is permanent
- [x] A 4xx and a 5xx per channel are covered by tests
- [x] No channel error text carries a URL, a token, or a chat id
