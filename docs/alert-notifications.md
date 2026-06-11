# Alert Notification Configuration

Everr alert notification settings are split between server-side delivery
configuration and organization-level UI settings.

Server operators configure provider credentials with environment variables.
Organization admins choose the delivery channels and recipients from the Alerts
page. Secrets are not stored in alert settings.

## Required Access

To change notification settings in the UI, the user must be an organization
owner or admin.

The settings apply to the active organization. They are not configured through
alert YAML, `everr.yaml`, or the apply API.

## Server Configuration

### Telegram

Telegram delivery uses one server-side bot token:

```sh
EVERR_ALERTS_TELEGRAM_BOT_TOKEN="<telegram-bot-token>"
```

This token belongs in the app runtime environment. Do not put the token in the
database, alert YAML, or the UI.

Typical setup:

1. Create a Telegram bot with BotFather.
2. Store the bot token in `EVERR_ALERTS_TELEGRAM_BOT_TOKEN`.
3. Restart the app process so the new environment variable is loaded.
4. Add the bot to every Telegram chat that should receive alerts.
5. Collect each chat id and enter it in the Everr UI.

Chat ids can be user ids, group ids, or channel ids. Group and supergroup ids
are commonly negative, and supergroup ids commonly start with `-100`.

One practical way to discover a chat id during setup is:

1. Add the bot to the target chat.
2. Send a message in that chat.
3. Call Telegram `getUpdates` with the bot token.
4. Read the `message.chat.id` value from the response.

The UI accepts multiple chat ids separated by commas or new lines.

### Email

Email delivery uses the existing app mailer.

Required environment variables:

```sh
EMAIL_FROM="alerts@example.com"
RESEND_API_KEY="<resend-api-key>"
```

In production, Everr sends email through Resend. `EMAIL_FROM` must be an email
address that Resend is allowed to send from, usually from a verified domain.

In local development, the mailer uses Nodemailer against the local Mailpit SMTP
server at `localhost:1025`. The Docker Compose setup exposes Mailpit at:

```text
SMTP: localhost:1025
Web UI: http://localhost:8025
```

The current app environment schema still requires `RESEND_API_KEY` to be set,
even though development delivery uses Mailpit.

## Organization UI Settings

Open the app and go to:

```text
Alerts -> Notification settings
```

The dialog contains two settings:

### Email

Enable `Email`, then enter one or more recipient email addresses.

Accepted format:

```text
alerts@example.com
oncall@example.com
```

or:

```text
alerts@example.com, oncall@example.com
```

If Email is disabled, or if the recipient list is empty, Everr does not send
email notifications.

### Telegram

Enable `Telegram`, then enter one or more Telegram chat ids.

Accepted format:

```text
-1001234567890
123456789
```

or:

```text
-1001234567890, 123456789
```

If Telegram is disabled, or if the chat id list is empty, Everr does not send
Telegram notifications.

## Delivery Behavior

Everr sends notifications when alert instances newly fire. It does not resend a
notification on every evaluation while the same instance remains firing.

Every delivered notification includes a direct link to the alert detail page.
The link is built from `BETTER_AUTH_URL`, so that environment variable must
point to the public app origin in production.

Everr sends resolved notifications when the alert transitions to resolved, and
also sends a partial resolved notification when one or more instances resolve
while other instances remain firing. Partial resolved notifications list the
resolved instances and the number of instances still firing.

Instance silences suppress notifications for matching firing instances during
the silence window. Evaluation continues while an alert or instance is silenced.

## Troubleshooting

### Telegram Notifications Are Not Sent

Check:

- `EVERR_ALERTS_TELEGRAM_BOT_TOKEN` is set in the app runtime.
- The app process was restarted after setting the token.
- The bot was added to the target chat.
- The chat id in the UI is correct.
- The Telegram channel or group allows the bot to post messages.
- The alert is not silenced.
- Telegram is enabled in `Alerts -> Notification settings`.

Relevant log events:

```text
telegram.send.failed
alerts.delivery.telegram_failed
```

### Email Notifications Are Not Sent

Check:

- `EMAIL_FROM` is set.
- `RESEND_API_KEY` is set.
- In production, the `EMAIL_FROM` domain is verified in Resend.
- In development, Mailpit is running and reachable at `localhost:1025`.
- Email is enabled in `Alerts -> Notification settings`.
- The recipient list is not empty.
- The alert is not silenced.

Relevant log events:

```text
mailer.send.failed
alerts.delivery.email_failed
```

### No Notification On Repeated Evaluations

This is expected when the same alert instance is still firing. Everr notifies on
state transitions, not on every successful evaluation.

For a new firing notification, a new instance must appear or a previously
resolved alert instance must fire again.
