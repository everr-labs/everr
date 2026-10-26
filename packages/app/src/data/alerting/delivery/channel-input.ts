/**
 * What a channel editor types, and what the write takes from it. The one
 * place that knows a stored secret is never shown again and how a blank
 * field says "keep it": the dialog omits that field and the server resolves
 * it, so the read-side redaction marker never enters a write.
 */
import { AlertingChannelConfigInputSchema } from "../schema";
import type { AlertingChannelConfig, AlertingChannelConfigInput } from "../types";

export type ChannelType = AlertingChannelConfig["type"];

/** One webhook header as the editor holds it. `retainedName` is the stored
 *  header a blank value keeps. A row the reader added has none, so a blank
 *  value there is incomplete rather than a retain. */
export type WebhookHeaderDraft = {
  /** Stable for the life of the row, so removing one does not reuse the next row's edit state. */
  id: string;
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
            id: crypto.randomUUID(),
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

/** What the reader has to change, keyed by the draft field that says so.
 *  A header row's own fields are addressed by their index in the draft list. */
export type ChannelDraftErrors = Partial<
  Record<
    "url" | "botToken" | "chatIds" | "headers" | `headers[${number}].${"name" | "value"}`,
    string
  >
>;

/** The header list a webhook write should carry, plus the row fields that
 *  block it. Fully blank rows are the unused "add header" slot and are dropped.
 *  A blank value keeps a stored header only while the URL stays the one it
 *  was saved for. A typed URL is a new endpoint, so that value has to be entered. */
function webhookHeadersFromDraft(headers: WebhookHeaderDraft[], retainStored: boolean) {
  const errors: ChannelDraftErrors = {};
  const filledIndexes: number[] = [];
  const firstWithName = new Map<string, number>();
  const write: { name: string; value?: string }[] = [];

  for (const [index, header] of headers.entries()) {
    const name = header.name.trim();
    if (name === "" && header.value === "") continue;
    filledIndexes.push(index);
    if (name === "") {
      errors[`headers[${index}].name`] = "Header name is required";
      continue;
    }
    const first = firstWithName.get(name.toLowerCase());
    if (first === undefined) {
      firstWithName.set(name.toLowerCase(), index);
    } else {
      errors[`headers[${first}].name`] ??= `Header ${headers[first].name.trim()} is already set`;
      errors[`headers[${index}].name`] = `Header ${name} is already set`;
    }
    const retains =
      retainStored && header.retainedName !== null && sameHeaderName(name, header.retainedName);
    if (header.value) write.push({ name, value: header.value });
    else if (retains) write.push({ name });
    else errors[`headers[${index}].value`] = `Header value is required for ${name}`;
  }

  return { errors, headers: write, filledIndexes };
}

/** A schema issue's path addresses the filtered write list. Put it on the
 *  draft row field that produced that entry, or on the list as a whole. */
function headerErrorsFromIssues(
  filledIndexes: number[],
  issues: readonly { path: PropertyKey[]; message: string }[],
): ChannelDraftErrors {
  const errors: ChannelDraftErrors = {};
  for (const { path, message } of issues) {
    const [, index, field] = path;
    const row = typeof index === "number" ? filledIndexes[index] : undefined;
    if (row !== undefined && (field === "name" || field === "value")) {
      errors[`headers[${row}].${field}`] ??= message;
    } else {
      errors.headers ??= message;
    }
  }
  return errors;
}

/** What one read of a draft can be: a write, or what stops it. */
export type ChannelDraftRead =
  | { config: AlertingChannelConfigInput }
  | { errors: ChannelDraftErrors };

/** Where a schema issue on a write belongs on the draft. */
function draftErrorsFromIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): ChannelDraftErrors {
  const errors: ChannelDraftErrors = {};
  for (const { path, message } of issues) {
    if (path[0] === "bot_token") errors.botToken ??= message;
    else if (path[0] === "chat_ids") errors.chatIds ??= message;
    else errors.url ??= message;
  }
  return errors;
}

/**
 * The one read of a channel draft. On an edit that keeps the stored kind, a
 * blank secret is omitted. A Slack channel turned into a webhook has no
 * webhook URL to retain, so a blank secret there is required.
 */
export function readChannelDraft(
  draft: ChannelConfigDraft,
  storedType: ChannelType | null,
): ChannelDraftRead {
  const keepsSecret = storedType === draft.type;
  switch (draft.type) {
    case "webhook": {
      const headers = webhookHeadersFromDraft(draft.headers, keepsSecret && draft.url === "");
      const errors: ChannelDraftErrors = headers.errors;
      if (!draft.url && !keepsSecret) errors.url = "URL is required";
      if (Object.keys(errors).length > 0) return { errors };
      const parsed = AlertingChannelConfigInputSchema.safeParse({
        type: draft.type,
        ...(draft.url ? { url: draft.url } : {}),
        // Always present, including empty: the form's list is the whole
        // list, so a row the reader removed has to clear the saved header.
        headers: headers.headers,
      });
      if (parsed.success) return { config: parsed.data };
      const headerIssues = parsed.error.issues.filter((issue) => issue.path[0] === "headers");
      if (headerIssues.length === 0) return { errors: draftErrorsFromIssues(parsed.error.issues) };
      return { errors: headerErrorsFromIssues(headers.filledIndexes, headerIssues) };
    }
    case "slack":
    case "discord": {
      if (!draft.url && !keepsSecret) return { errors: { url: "URL is required" } };
      const parsed = AlertingChannelConfigInputSchema.safeParse({
        type: draft.type,
        ...(draft.url ? { url: draft.url } : {}),
      });
      return parsed.success
        ? { config: parsed.data }
        : { errors: draftErrorsFromIssues(parsed.error.issues) };
    }
    case "telegram": {
      const errors: ChannelDraftErrors = {};
      if (!draft.botToken && !keepsSecret) errors.botToken = "Bot token is required";
      if (draft.chatIds.length === 0) errors.chatIds = "Add at least one chat ID";
      if (errors.botToken || errors.chatIds) return { errors };
      const parsed = AlertingChannelConfigInputSchema.safeParse({
        type: draft.type,
        ...(draft.botToken ? { bot_token: draft.botToken } : {}),
        chat_ids: draft.chatIds,
      });
      return parsed.success
        ? { config: parsed.data }
        : { errors: draftErrorsFromIssues(parsed.error.issues) };
    }
  }
}
