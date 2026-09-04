/**
 * What a channel editor types, and what the write takes from it. The one
 * place that knows a stored secret is never shown again and how a blank
 * field says "keep it": the dialog omits that field and the server resolves
 * it, so the read-side redaction marker never enters a write.
 */
import { AlertingChannelConfigInputSchema } from "../schema";
import type {
  AlertingChannelConfig,
  AlertingChannelConfigInput,
} from "../types";

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
 * edit that keeps the stored kind, a blank secret is omitted. A Slack channel
 * turned into a webhook has no webhook URL to retain, so a blank secret there
 * is incomplete.
 */
export function channelConfigInput(
  draft: ChannelConfigDraft,
  storedType: ChannelType | null,
): AlertingChannelConfigInput | null {
  const keepsSecret = storedType === draft.type;
  let config: AlertingChannelConfigInput | null;
  switch (draft.type) {
    case "webhook":
    case "slack":
    case "discord": {
      if (!draft.url && !keepsSecret) return null;
      config = {
        type: draft.type,
        ...(draft.url ? { url: draft.url } : {}),
      };
      break;
    }
    case "telegram": {
      if ((!draft.botToken && !keepsSecret) || draft.chatIds.length === 0) {
        return null;
      }
      config = {
        type: draft.type,
        ...(draft.botToken ? { bot_token: draft.botToken } : {}),
        chat_ids: draft.chatIds,
      };
      break;
    }
  }
  const parsed = AlertingChannelConfigInputSchema.safeParse(config);
  return parsed.success ? parsed.data : null;
}
