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

/** Which controls on one draft row the reader has to change. Parallel to
 *  `ChannelConfigDraft["headers"]`, including a blank row the write drops. */
export type WebhookHeaderRowInvalid = {
  name: boolean;
  value: boolean;
};

/** Why a webhook draft cannot be saved, and which row fields say so. */
export type ChannelDraftProblem = {
  message: string;
  rows: WebhookHeaderRowInvalid[];
};

/** The header list a webhook write should carry, plus the row fields that
 *  block it. Fully blank rows are the unused "add header" slot and are dropped.
 *  A blank value keeps a stored header only while the URL stays the one it
 *  was saved for. A typed URL is a new endpoint, so that value has to be entered. */
function webhookHeadersFromDraft(headers: WebhookHeaderDraft[], retainStored: boolean) {
  const rows: WebhookHeaderRowInvalid[] = headers.map(() => ({ name: false, value: false }));
  const filledIndexes: number[] = [];
  const seen = new Map<string, number[]>();
  const write: { name: string; value?: string }[] = [];
  let message: string | null = null;
  const fail = (text: string) => {
    message ??= text;
  };

  for (const [index, header] of headers.entries()) {
    const name = header.name.trim();
    if (name === "" && header.value === "") continue;
    filledIndexes.push(index);
    if (name === "") {
      rows[index].name = true;
      fail("Header name is required");
      continue;
    }
    const key = name.toLowerCase();
    const prior = seen.get(key);
    if (prior) {
      rows[index].name = true;
      for (const other of prior) rows[other].name = true;
      prior.push(index);
      fail(`Header ${name} is already set`);
    } else {
      seen.set(key, [index]);
    }
    const retains =
      retainStored && header.retainedName !== null && sameHeaderName(name, header.retainedName);
    if (!header.value) {
      if (!retains) {
        rows[index].value = true;
        fail(`Header value is required for ${name}`);
      } else if (message === null) {
        write.push({ name });
      }
      continue;
    }
    if (message === null) write.push({ name, value: header.value });
  }

  return { message, rows, headers: write, filledIndexes };
}

/** A schema issue's path addresses the filtered write list. Mark the draft
 *  row that produced that entry. */
function markHeaderIssues(
  rows: WebhookHeaderRowInvalid[],
  filledIndexes: number[],
  issues: readonly { path: PropertyKey[] }[],
) {
  for (const issue of issues) {
    const fieldAt = issue.path.findIndex((part) => part === "name" || part === "value");
    if (fieldAt < 1) continue;
    const index = issue.path[fieldAt - 1];
    if (typeof index !== "number") continue;
    const row = filledIndexes[index];
    if (row === undefined || !rows[row]) continue;
    if (issue.path[fieldAt] === "name") rows[row].name = true;
    else rows[row].value = true;
  }
}

/** What the reader has to change, keyed by the draft field that says so. */
export type ChannelDraftErrors = {
  url?: string;
  botToken?: string;
  chatIds?: string;
  headers?: ChannelDraftProblem;
};

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
  const errors: ChannelDraftErrors = {};
  switch (draft.type) {
    case "webhook": {
      const headers = webhookHeadersFromDraft(draft.headers, keepsSecret && draft.url === "");
      if (headers.message) errors.headers = { message: headers.message, rows: headers.rows };
      if (!draft.url && !keepsSecret) errors.url = "URL is required";
      if (errors.headers || errors.url) return { errors };
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
      markHeaderIssues(headers.rows, headers.filledIndexes, headerIssues);
      return { errors: { headers: { message: headerIssues[0].message, rows: headers.rows } } };
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
