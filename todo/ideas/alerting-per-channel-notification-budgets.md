# Per-channel notification budgets

## Today

`formatNotification` composes one `{title, body}` per notification group and
every channel delivery receives that same payload. The body is bounded once,
to fit the tightest channel: Discord caps message content at 2000 characters,
so the composer budgets 1800 characters for the body and closes with an
"…and N more events in this group" line when it cuts. Each sender also
carries a dumb truncation belt at its own hard limit (Slack 3000 per section,
Discord 2000, Telegram 4096) so no future caller can reproduce the
reject-and-burn-retries failure.

## The idea

Let the composer know each channel's budget and compose per channel:

- Slack gets up to 3000 characters per section, Telegram 4096, email and
  webhooks the full group.
- The omitted-count line stays honest at every budget because the composer,
  not the sender, does the cutting.

## What it costs

The flush path composes once at group-flush time and fans the payload out to
every channel of the delivery. Per-channel budgets need one of:

1. Compose at send time, per channel, from the journal events. The events
   must be re-read in `send-delivery`, which re-couples the sender to the
   journal shape.
2. Compose all channel variants at flush time and store one payload per
   channel on the delivery row.

Both restructure the flush-to-send contract. Do this only when a real user
asks for richer channel bodies; the notification is a pointer to the alert
page, and the content between the shared budget and a channel's ceiling is
low-value label listings.
