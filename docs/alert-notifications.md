# Alert Notification Configuration

Everr alert notification settings are organization-level UI settings.
Organization admins choose delivery channels, recipients, and channel
credentials from the Alerts page.

## Required Access

To change notification settings in the UI, the user must be an organization
owner or admin.

The settings apply to the active organization. They are not configured through
alert YAML, `everr.yaml`, or the apply API.

## Organization UI Settings

Open the app and go to:

```text
Alerts -> Notification settings
```

The dialog contains Telegram and Slack notification settings.

### Telegram

Enable `Telegram`, then add one or more entries. Each entry pairs a **bot
token** with a **chat id** and an optional **name**. Entries are immutable:
you add or delete them, you do not edit them in place.

The bot token is write-only. After saving, Everr never exposes it again. To
change a token, delete the entry and add a new one. The chat id remains
visible.

Accepted bot token format: `123456789:ABC...`

Chat ids can be user ids, group ids, or channel ids. Group and supergroup ids
are commonly negative, and supergroup ids commonly start with `-100`.

Typical setup:

1. Create a Telegram bot with BotFather.
2. Add the bot to every Telegram chat that should receive alerts.
3. For each chat, add an entry in the Everr UI with the bot token and chat id.

One practical way to discover a chat id during setup is:

1. Add the bot to the target chat.
2. Send a message in that chat.
3. Call Telegram `getUpdates` with the bot token.
4. Read the `message.chat.id` value from the response.

If Telegram is disabled or has no entries, Everr does not send Telegram
notifications.

### Slack

Enable `Slack`, then add one or more Incoming Webhook URLs. Each Slack webhook
posts to one channel. Create a webhook from your workspace's app settings,
copy the `https://hooks.slack.com/services/...` URL, and add it here with an
optional name.

Webhook URLs are write-only. After saving, Everr never exposes them again. To
change a URL, delete the entry and add a new one. Every enabled webhook
receives every alert notification for the organization.

## Delivery Behavior

Everr sends one notification per evaluation, summarizing all instance changes.
If a rule fires for three services in the same evaluation, you get one
notification listing all three.

Notifications go out on the edges only: once when instances newly fire, and
once when they resolve, not repeatedly while they keep firing.

Mixed evaluations (some firing, some resolving) produce a single combined
notification with both sections.

Every delivered notification includes a direct link to the alert detail page.
The link is built from `BETTER_AUTH_URL`, so that environment variable must
point to the public app origin in production.

Instance silences filter out individual instances from notifications. If all
instances are silenced, no notification is sent. Evaluation continues while an
alert or instance is silenced.

## Troubleshooting

### Telegram Notifications Are Not Sent

Check:

- A bot token is configured in `Alerts -> Notification settings`.
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

### Slack Notifications Are Not Sent

Check:

- At least one Incoming Webhook URL is configured in `Alerts -> Notification settings`.
- The webhook URL is valid and the Slack app is still installed in the workspace.
- The alert is not silenced.
- Slack is enabled in `Alerts -> Notification settings`.

Relevant log events:

```text
alerts.delivery.slack_failed
```

### No Notification On Repeated Evaluations

This is expected when the same alert instance is still firing. Everr notifies on
state transitions, not on every successful evaluation.

For a new firing notification, a new instance must appear or a previously
resolved alert instance must fire again.
