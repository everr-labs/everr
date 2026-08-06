import type { AlertingChannelConfig } from "./types";

export function emailTestConfigFor(
  config: AlertingChannelConfig,
  callerEmail: string,
): AlertingChannelConfig {
  return config.type === "email" ? { ...config, to: [callerEmail] } : config;
}
