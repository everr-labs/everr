import type { AlertingChannelConfig } from "../types";

export type IssueChannelConfig = Extract<
  AlertingChannelConfig,
  { type: "github_issues" | "linear" }
>;

/**
 * Whether a channel files issues instead of sending messages. An issue channel
 * delivers one alert instance at a time, keeps one issue per instance, and is
 * never made the default destination on its own.
 */
export function isIssueChannel(config: AlertingChannelConfig): config is IssueChannelConfig {
  return config.type === "github_issues" || config.type === "linear";
}
