/**
 * What a channel editor types, and what the write takes from it. The one
 * place that knows a stored secret is never shown again and how a blank
 * field says "keep it": the dialog omits that field and the server resolves
 * it, so the read-side redaction marker never enters a write.
 */
import { AlertingChannelConfigInputSchema } from "../schema";
import type { AlertingChannelConfig, AlertingChannelConfigInput } from "../types";

export type ChannelType = AlertingChannelConfig["type"];

/** One webhook header as the editor holds it. A blank value on a stored name
 *  means the saved value stays; a blank value on a new name is incomplete.
 *  `id` is the editor's stable row key, not part of the saved config. */
export type ChannelHeaderDraft = {
  id: string;
  name: string;
  value: string;
};

let nextHeaderId = 0;

/** A header row, keyed so reordering or removing one cannot move another
 *  row's local input state onto it. */
export function emptyChannelHeaderDraft(name = "", value = ""): ChannelHeaderDraft {
  nextHeaderId += 1;
  return { id: `header-${nextHeaderId}`, name, value };
}

/** Every per-type field kept side by side, so switching the type never
 *  loses what was typed. */
export type ChannelConfigDraft = {
  type: ChannelType;
  url: string;
  botToken: string;
  chatIds: string[];
  headers: ChannelHeaderDraft[];
};

export const EMPTY_CHANNEL_DRAFT: ChannelConfigDraft = {
  type: "slack",
  url: "",
  botToken: "",
  chatIds: [],
  headers: [],
};

/** The draft an edit starts from: the stored kind, the chats, and the header
 *  names, never a secret, which the read redacted and the editor re-enters or
 *  leaves. */
export function channelConfigDraft(stored: AlertingChannelConfig): ChannelConfigDraft {
  return {
    ...EMPTY_CHANNEL_DRAFT,
    type: stored.type,
    chatIds: stored.type === "telegram" ? stored.chat_ids : [],
    headers:
      stored.type === "webhook"
        ? (stored.headers ?? []).map(({ name }) => emptyChannelHeaderDraft(name))
        : [],
  };
}

/**
 * The config the draft describes, or `null` while it cannot be saved. On an
 * edit that keeps the stored kind, a blank secret is omitted. A Slack channel
 * turned into a webhook has no webhook URL to retain, so a blank secret there
 * is incomplete. Header values work the same way as the URL secret, one name
 * at a time: a stored name with a blank value keeps what is saved, while a
 * new name needs a value.
 */
export function channelConfigInput(
  draft: ChannelConfigDraft,
  stored: AlertingChannelConfig | null,
): AlertingChannelConfigInput | null {
  const keepsSecret = stored?.type === draft.type;
  let config: AlertingChannelConfigInput | null;
  switch (draft.type) {
    case "webhook": {
      if (!draft.url && !keepsSecret) return null;
      const storedHeaders = keepsSecret && stored?.type === "webhook" ? (stored.headers ?? []) : [];
      const storedNames = new Set(storedHeaders.map((header) => header.name.toLowerCase()));
      const headers = draft.headers
        .map((header) => ({
          name: header.name.trim(),
          value: header.value,
        }))
        // A just-added row with nothing in it is not an error, it is a row
        // the reader has not filled in yet.
        .filter((header) => header.name.length > 0 || header.value.length > 0);
      const inputHeaders: { name: string; value?: string }[] = [];
      for (const header of headers) {
        if (!header.name) return null;
        if (header.value) {
          inputHeaders.push(header);
        } else if (storedNames.has(header.name.toLowerCase())) {
          inputHeaders.push({ name: header.name });
        } else {
          // A new header with no value (or a renamed stored one) cannot send.
          return null;
        }
      }
      config = {
        type: "webhook",
        ...(draft.url ? { url: draft.url } : {}),
        headers: inputHeaders,
      };
      break;
    }
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
