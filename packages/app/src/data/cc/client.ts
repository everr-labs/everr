import { z } from "zod";
import { CcApiError, ccRequest } from "@/lib/clickety-clack.server";
import {
  CcAlertSchema,
  CcChannelSchema,
  CcChannelTestResultSchema,
  CcDeletedSchema,
  CcInhibitionSchema,
  CcReceiverSchema,
  CcRouteSchema,
  CcRuleInputSchema,
  CcRuleSchema,
  CcRuleSpecSchema,
  CcRulesPageSchema,
  CcRuleViewSchema,
  CcSilenceSchema,
  CcSloInputSchema,
  CcSloSchema,
  CcSloSpecSchema,
  CcSloStatusSchema,
  CcSloTestResultSchema,
  CcSloUpdateSchema,
  CcSloViewSchema,
  CcSubscriptionSchema,
} from "./schema";
import type {
  CcChannelConfig,
  CcInhibitionInput,
  CcRouteInput,
  CcRuleInput,
  CcRuleSpec,
  CcSilenceInput,
  CcSloInput,
  CcSloSpec,
  CcSloUpdate,
} from "./types";

// ---- Rules ----
/**
 * `limit` (1..=500) opts into the `{items, next_cursor}` envelope; `cursor`
 * resumes a page. `namespace`/`name` filter by exact match on first-class
 * identity. The unpaginated GET /v1/rules mode is being removed from CC.
 */
export async function listRulesPage(
  orgId: string,
  opts: {
    limit?: number;
    cursor?: string;
    namespace?: string;
    name?: string;
  } = {},
) {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 100) });
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.namespace !== undefined) params.set("namespace", opts.namespace);
  if (opts.name !== undefined) params.set("name", opts.name);
  return CcRulesPageSchema.parse(
    await ccRequest(orgId, "GET", `/v1/rules?${params.toString()}`),
  );
}
/**
 * Every rule, walking {@link listRulesPage} until `next_cursor` runs out
 * (500 per request). `namespace`/`name` forward to every page.
 */
export async function listAllRules(
  orgId: string,
  opts: { namespace?: string; name?: string } = {},
) {
  const all: z.infer<typeof CcRuleViewSchema>[] = [];
  let cursor: string | undefined;
  do {
    const page = await listRulesPage(orgId, {
      limit: 500,
      ...opts,
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
}
export async function getRule(orgId: string, id: string) {
  return CcRuleViewSchema.parse(
    await ccRequest(orgId, "GET", `/v1/rules/${id}`),
  );
}
/** CC's create body is the spec flattened beside `name`/`namespace` (CreateRuleBody). */
export async function createRule(orgId: string, input: CcRuleInput) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "POST", "/v1/rules", CcRuleInputSchema.parse(input)),
  );
}
/**
 * Full-spec update with optional optimistic-concurrency `version`: a stale
 * version answers 409 and writes nothing; omitting it is last-write-wins.
 * Preserves id, tenant, paused flag, and instance state (instances are
 * cleared only when the label_columns set changes).
 */
export async function updateRule(
  orgId: string,
  id: string,
  spec: CcRuleSpec,
  version?: number,
) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "PUT", `/v1/rules/${id}`, {
      ...CcRuleSpecSchema.parse(spec),
      ...(version === undefined ? {} : { version }),
    }),
  );
}
export async function deleteRule(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/rules/${id}`),
  );
}
export async function pauseRule(orgId: string, id: string) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "POST", `/v1/rules/${id}/pause`),
  );
}
export async function resumeRule(orgId: string, id: string) {
  return CcRuleSchema.parse(
    await ccRequest(orgId, "POST", `/v1/rules/${id}/resume`),
  );
}

// ---- Alerts ----
export async function listAlerts(orgId: string) {
  return z
    .array(CcAlertSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/alerts"));
}

// ---- SLOs ----
// List/get return the SloView; create/update/pause/resume answer the bare Slo.
export async function listSlos(
  orgId: string,
  opts: { namespace?: string; name?: string } = {},
) {
  const params = new URLSearchParams();
  if (opts.namespace !== undefined) params.set("namespace", opts.namespace);
  if (opts.name !== undefined) params.set("name", opts.name);
  const qs = params.toString();
  return z
    .array(CcSloViewSchema)
    .parse(await ccRequest(orgId, "GET", `/v1/slos${qs ? `?${qs}` : ""}`));
}
export async function getSlo(orgId: string, id: string) {
  return CcSloViewSchema.parse(await ccRequest(orgId, "GET", `/v1/slos/${id}`));
}
/**
 * CC answers a pending status (null `computed_at`/`payload`) until the first
 * evaluation writes a snapshot. `health` is real even then: it lives on the
 * SLO row, not the snapshot, so a from-birth-broken SLI reports degraded while
 * still pending. A 404 (the SLO itself is gone, e.g. a delete race) reads as
 * null rather than an error.
 */
export async function getSloStatus(orgId: string, id: string) {
  try {
    return CcSloStatusSchema.parse(
      await ccRequest(orgId, "GET", `/v1/slos/${id}/status`),
    );
  } catch (error) {
    if (error instanceof CcApiError && error.status === 404) return null;
    throw error;
  }
}
/** CC's create body is the spec flattened beside `name` (CreateSloBody). */
export async function createSlo(orgId: string, input: CcSloInput) {
  return CcSloSchema.parse(
    await ccRequest(orgId, "POST", "/v1/slos", CcSloInputSchema.parse(input)),
  );
}
/**
 * Full-body spec replace (no name/namespace: identity is immutable after
 * create), optional optimistic-concurrency `version` (stale = 409, no write;
 * omitted = last-write-wins). The paused flag survives updates.
 */
export async function updateSlo(
  orgId: string,
  id: string,
  input: CcSloUpdate,
  version?: number,
) {
  return CcSloSchema.parse(
    await ccRequest(orgId, "PUT", `/v1/slos/${id}`, {
      ...CcSloUpdateSchema.parse(input),
      ...(version === undefined ? {} : { version }),
    }),
  );
}
export async function deleteSlo(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/slos/${id}`),
  );
}
export async function pauseSlo(orgId: string, id: string) {
  return CcSloSchema.parse(
    await ccRequest(orgId, "POST", `/v1/slos/${id}/pause`),
  );
}
export async function resumeSlo(orgId: string, id: string) {
  return CcSloSchema.parse(
    await ccRequest(orgId, "POST", `/v1/slos/${id}/resume`),
  );
}
/**
 * Dry-run: validates the spec and runs the SLI over its own budget window; no
 * DB write, no snapshot, so the bare spec needs no identity.
 */
export async function testSlo(orgId: string, spec: CcSloSpec) {
  return CcSloTestResultSchema.parse(
    await ccRequest(
      orgId,
      "POST",
      "/v1/slos/test",
      CcSloSpecSchema.parse(spec),
    ),
  );
}

// ---- Channels ----
export async function listChannels(orgId: string) {
  return z
    .array(CcChannelSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/channels"));
}
/** CC's POST /v1/channels is create-only: an existing name answers 409. */
export async function createChannel(
  orgId: string,
  body: { name: string; config: CcChannelConfig },
) {
  return CcChannelSchema.parse(
    await ccRequest(orgId, "POST", "/v1/channels", body),
  );
}
/**
 * PUT is an upsert that replaces the config wholesale: secret fields are
 * write-only (redacted on read), so an edit re-enters them. A body `name`
 * different from the path renames the channel (equal is a plain replace);
 * receivers reference channels by id inside the engine, so the rename never
 * breaks them.
 */
export async function updateChannel(
  orgId: string,
  name: string,
  body: { name?: string; config: CcChannelConfig },
) {
  return CcChannelSchema.parse(
    await ccRequest(
      orgId,
      "PUT",
      `/v1/channels/${encodeURIComponent(name)}`,
      body,
    ),
  );
}
/** CC answers 409 (CcApiError naming the referring receivers) while referenced. */
export async function deleteChannel(orgId: string, name: string) {
  return CcDeletedSchema.parse(
    await ccRequest(
      orgId,
      "DELETE",
      `/v1/channels/${encodeURIComponent(name)}`,
    ),
  );
}

/**
 * Email tests deliver to the caller's own address, never the typed recipient
 * list: the test endpoint sends arbitrary configs, so without this any
 * authenticated user could use Everr as a mail relay (webhook/Slack URLs are
 * covered by CC's SSRF guard). Proves SMTP works, not that the typed address
 * is correct.
 */
export function emailTestConfigFor(
  config: CcChannelConfig,
  callerEmail: string,
): CcChannelConfig {
  return config.type === "email" ? { ...config, to: [callerEmail] } : config;
}

/** Send one synthetic notification through an unsaved channel config. */
export async function testChannel(
  orgId: string,
  body: { config: CcChannelConfig },
) {
  return CcChannelTestResultSchema.parse(
    await ccRequest(orgId, "POST", "/v1/channel-tests", body),
  );
}

// ---- Receivers ----
export async function listReceivers(orgId: string) {
  return z
    .array(CcReceiverSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/receivers"));
}
/** CC's POST /v1/receivers is create-only: an existing name answers 409. */
export async function createReceiver(
  orgId: string,
  body: { name: string; channels: string[] },
) {
  return CcReceiverSchema.parse(
    await ccRequest(orgId, "POST", "/v1/receivers", body),
  );
}
/**
 * PUT is an upsert of exactly the fields the app UI edits. The engine treats
 * an absent `annotations` as `{}`, so an app-side edit deliberately resets any
 * API-set annotations: the app manages only what its UI can show and change.
 * A body `name` different from the path renames the receiver; routes target
 * receivers by id inside the engine, so the rename never breaks them.
 */
export async function updateReceiver(
  orgId: string,
  name: string,
  body: {
    name?: string;
    channels: string[];
  },
) {
  return CcReceiverSchema.parse(
    await ccRequest(
      orgId,
      "PUT",
      `/v1/receivers/${encodeURIComponent(name)}`,
      body,
    ),
  );
}
export async function deleteReceiver(orgId: string, name: string) {
  return CcDeletedSchema.parse(
    await ccRequest(
      orgId,
      "DELETE",
      `/v1/receivers/${encodeURIComponent(name)}`,
    ),
  );
}

// ---- Routes ----
export async function listRoutes(orgId: string) {
  return z
    .array(CcRouteSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/routes"));
}
export async function createRoute(orgId: string, input: CcRouteInput) {
  return CcRouteSchema.parse(
    await ccRequest(orgId, "POST", "/v1/routes", input),
  );
}
/** Full-body replace of an existing route (same shape as create). */
export async function updateRoute(
  orgId: string,
  id: string,
  input: CcRouteInput,
) {
  return CcRouteSchema.parse(
    await ccRequest(orgId, "PUT", `/v1/routes/${id}`, input),
  );
}
export async function deleteRoute(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/routes/${id}`),
  );
}

// ---- Inhibitions ----
export async function listInhibitions(orgId: string) {
  return z
    .array(CcInhibitionSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/inhibitions"));
}
export async function createInhibition(
  orgId: string,
  input: CcInhibitionInput,
) {
  return CcInhibitionSchema.parse(
    await ccRequest(orgId, "POST", "/v1/inhibitions", input),
  );
}
export async function deleteInhibition(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/inhibitions/${id}`),
  );
}

// ---- Silences ----
export async function listSilences(orgId: string) {
  return z
    .array(CcSilenceSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/silences"));
}
export async function createSilence(orgId: string, input: CcSilenceInput) {
  return CcSilenceSchema.parse(
    await ccRequest(orgId, "POST", "/v1/silences", input),
  );
}
export async function deleteSilence(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/silences/${id}`),
  );
}

// ---- Subscriptions ----
export async function listSubscriptions(orgId: string) {
  return z
    .array(CcSubscriptionSchema)
    .parse(await ccRequest(orgId, "GET", "/v1/subscriptions"));
}
export async function createSubscription(orgId: string, webhookUrl: string) {
  return CcSubscriptionSchema.parse(
    await ccRequest(orgId, "POST", "/v1/subscriptions", {
      webhook_url: webhookUrl,
    }),
  );
}
export async function deleteSubscription(orgId: string, id: string) {
  return CcDeletedSchema.parse(
    await ccRequest(orgId, "DELETE", `/v1/subscriptions/${id}`),
  );
}
