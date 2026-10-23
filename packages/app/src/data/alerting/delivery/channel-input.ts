/**
 * What a channel editor types, and what the write takes from it. The one
 * place that knows a stored secret is never shown again and how a blank
 * field says "keep it": the dialog omits that field and the server resolves
 * it, so the read-side redaction marker never enters a write.
 */
import { firstZodIssue } from "#app/lib/zod-issue.ts";
import { AlertingChannelConfigInputSchema } from "../schema";
import type { AlertingChannelConfig, AlertingChannelConfigInput } from "../types";

export type ChannelType = AlertingChannelConfig["type"];

/** One webhook header as the editor holds it. `retainedName` is the stored
 *  header a blank value keeps. A row the reader added has none, so a blank
 *  value there is incomplete rather than a retain. */
export type WebhookHeaderDraft = {
  name: string;
  value: string;
  retainedName: string | null;
};

/** Every per-type field kept side by side, so switching the type never
 *  loses what was typed. */
export type ChannelConfigDraft = {
  type: ChannelType;
  url: string;
  botToken: string;
  chatIds: string[];
  headers: WebhookHeaderDraft[];
};

export const EMPTY_CHANNEL_DRAFT: ChannelConfigDraft = {
  type: "slack",
  url: "",
  botToken: "",
  chatIds: [],
  headers: [],
};

/** The draft an edit starts from: the stored kind and the chats, never the
 *  secret, which the read redacted and the editor re-enters or leaves. */
export function channelConfigDraft(stored: AlertingChannelConfig): ChannelConfigDraft {
  return {
    ...EMPTY_CHANNEL_DRAFT,
    type: stored.type,
    chatIds: stored.type === "telegram" ? stored.chat_ids : [],
    headers:
      stored.type === "webhook"
        ? (stored.headers ?? []).map((header) => ({
            name: header.name,
            value: "",
            retainedName: header.name,
          }))
        : [],
  };
}

function sameHeaderName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** The header list a webhook write should carry, or why it cannot yet.
 *  Fully blank rows are the unused "add header" slot and are dropped. */
function webhookHeadersFromDraft(
  headers: WebhookHeaderDraft[],
): { headers: { name: string; value?: string }[] } | { error: string } {
  const filled = headers.filter((header) => header.name.trim() !== "" || header.value !== "");
  const seen = new Set<string>();
  const result: { name: string; value?: string }[] = [];
  for (const header of filled) {
    const name = header.name.trim();
    if (name === "") return { error: "Header name is required" };
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `Header ${name} is already set` };
    seen.add(key);
    const retains = header.retainedName !== null && sameHeaderName(name, header.retainedName);
    if (!header.value) {
      if (!retains) return { error: `Header value is required for ${name}` };
      result.push({ name });
      continue;
    }
    result.push({ name, value: header.value });
  }
  return { headers: result };
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
    case "webhook": {
      if (!draft.url && !keepsSecret) return null;
      const headers = webhookHeadersFromDraft(draft.headers);
      if ("error" in headers) return null;
      config = {
        type: "webhook",
        ...(draft.url ? { url: draft.url } : {}),
        // Always present, including empty: the form's list is the whole
        // list, so a row the reader removed has to clear the saved header.
        headers: headers.headers,
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

/** Why a webhook draft cannot be saved, when the reason is something the
 *  reader typed rather than a secret they have not typed yet. */
export function channelDraftError(
  draft: ChannelConfigDraft,
  storedType: ChannelType | null,
): string | null {
  if (draft.type !== "webhook") return null;
  const headers = webhookHeadersFromDraft(draft.headers);
  if ("error" in headers) return headers.error;
  if (!draft.url && storedType !== "webhook") return null;
  const parsed = AlertingChannelConfigInputSchema.safeParse({
    type: "webhook",
    ...(draft.url ? { url: draft.url } : {}),
    headers: headers.headers,
  });
  if (parsed.success) return null;
  return parsed.error.issues[0]?.message ?? firstZodIssue(parsed.error);
}
