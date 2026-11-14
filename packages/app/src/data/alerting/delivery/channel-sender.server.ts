import type { AlertingChannelConfig } from "#app/data/alerting/types.ts";
import { sendDiscordNotification } from "./providers/discord";
import type { ChannelNotification } from "./providers/message";
import { sendSlackNotification } from "./providers/slack";
import { sendTelegramNotification } from "./providers/telegram";
import { ChannelSendError } from "./providers/outbound";
import { sendWebhookNotification } from "./providers/webhook";

// Re-exported so a caller that sends keeps one import: the send job needs the
// error type to classify a failure.
export { ChannelSendError };

/**
 * The one place a channel type turns into a send. Each provider under
 * `providers/` owns its whole channel: the payload shape, the limit it
 * composes to, and how its failures are reported. Adding a channel type means
 * adding a file there and a case here, and the exhaustive switch turns a
 * forgotten case into a compile error.
 *
 * A failure names our outcome. It does not carry the endpoint's answer, the
 * request URL, or a header value: any of those can be a secret, and the text
 * is stored and logged.
 */
export async function sendChannelNotification(
  config: AlertingChannelConfig,
  notification: ChannelNotification,
): Promise<void> {
  switch (config.type) {
    case "webhook":
      return sendWebhookNotification(config, notification);
    case "slack":
      return sendSlackNotification(config, notification);
    case "discord":
      return sendDiscordNotification(config, notification);
    case "telegram":
      return sendTelegramNotification(config, notification);
    case "github_issues":
    case "linear":
      // An issue channel delivers one alert instance at a time, through the
      // send job's own path. A grouped notification has no issue to land on.
      throw new ChannelSendError("an issue channel cannot take a grouped notification", {
        permanent: true,
      });
  }
}

/**
 * Prove the channel can deliver. A message channel gets a real test message.
 * An issue channel checks access instead: a test issue would land in the
 * team's backlog. Linear checks the key, the team and the assignee. GitHub
 * without a repository on the channel has nothing to check until a rule
 * fires, so only the organization's installation is.
 */
export async function sendChannelTest(
  organizationId: string,
  config: AlertingChannelConfig,
): Promise<void> {
  if (config.type === "linear") {
    const { linearTeamId, linearUserId } = await import("./providers/linear");
    await linearTeamId(config.api_key, config.team);
    if (config.assignee) await linearUserId(config.api_key, config.assignee);
    return;
  }
  if (config.type === "github_issues") {
    // Loaded on use: it reaches the database, which the message senders
    // never need.
    const { assertPrivateRepository, githubIssueToken, hasActiveGithubInstallation } =
      await import("./providers/github-issues");
    if (!config.repo) {
      if (!(await hasActiveGithubInstallation(organizationId))) {
        throw new ChannelSendError("this organization has no active GitHub App installation", {
          permanent: true,
        });
      }
      return;
    }
    const token = await githubIssueToken(organizationId, config.repo);
    await assertPrivateRepository(token, config.repo);
    return;
  }
  return sendChannelNotification(config, {
    title: "Everr test notification",
    body: "This channel is configured correctly.",
  });
}
