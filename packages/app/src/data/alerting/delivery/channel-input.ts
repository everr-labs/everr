/**
 * What a channel editor types, and what the write takes from it. The one
 * place that knows a stored secret is never shown again and how a blank
 * field says "keep it": the dialog draws fields, the server keeps secrets,
 * and neither has to know the marker the other reads.
 */
import { ALERTING_REDACTED_SECRET } from "../schema";
import type { AlertingChannelConfig } from "../types";

export type ChannelType = AlertingChannelConfig["type"];

/** Every per-type field kept side by side, so switching the type never
 *  loses what was typed. */
export type ChannelConfigDraft = {
  type: ChannelType;
  url: string;
  botToken: string;
  chatIds: string[];
};

export const EMPTY_CHANNEL_DRAFT: ChannelConfigDraft = {
  type: "slack",
  url: "",
  botToken: "",
  chatIds: [],
};

/** The draft an edit starts from: the stored kind and the chats, never the
 *  secret, which the read redacted and the editor re-enters or leaves. */
export function channelConfigDraft(
  stored: AlertingChannelConfig,
): ChannelConfigDraft {
  return {
    ...EMPTY_CHANNEL_DRAFT,
    type: stored.type,
    chatIds: stored.type === "telegram" ? stored.chat_ids : [],
  };
}

/**
 * The config the draft describes, or `null` while it cannot be saved. On an
 * edit that keeps the stored kind, a blank secret stands for the stored one
 * and goes out as the redaction marker, which the server reads as "keep". A
 * Slack channel turned into a webhook has no stored URL to keep, so a blank
 * secret there is incomplete.
 */
export function channelConfigInput(
  draft: ChannelConfigDraft,
  stored: AlertingChannelConfig | null,
): AlertingChannelConfig | null {
  const keepsSecret = stored !== null && stored.type === draft.type;
  const secret = (typed: string) =>
    typed || (keepsSecret ? ALERTING_REDACTED_SECRET : "");
  switch (draft.type) {
    case "webhook":
    case "slack":
    case "discord": {
      const url = secret(draft.url);
      return url ? { type: draft.type, url } : null;
    }
    case "telegram": {
      const botToken = secret(draft.botToken);
      return botToken && draft.chatIds.length > 0
        ? { type: draft.type, bot_token: botToken, chat_ids: draft.chatIds }
        : null;
    }
  }
}

/** Whether a send can be tried through this config. An edited channel can use
 *  its stored secret even though the screen only has the redaction marker. */
export function channelConfigIsTestable(
  config: AlertingChannelConfig,
  hasStoredSecret = false,
) {
  if (hasStoredSecret) return true;
  return config.type === "telegram"
    ? config.bot_token !== ALERTING_REDACTED_SECRET
    : config.url !== ALERTING_REDACTED_SECRET;
}
