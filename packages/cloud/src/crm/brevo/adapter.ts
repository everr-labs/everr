import { setTimeout as delay } from "node:timers/promises";
import * as z from "zod";
import type { DesiredProjection } from "../snapshots";
import type { BrevoBudget } from "./budget";
import type { readBrevoConfig } from "./config";

type Failure = {
  ok: false;
  kind:
    | "disabled"
    | "paused"
    | "cancelled"
    | "transient"
    | "rate_limited"
    | "permanent"
    | "identity_conflict"
    | "ambiguous_create"
    | "not_found";
  code: string;
  retryAt?: Date;
  status?: number;
  remoteId?: string;
};
type Result<T> = { ok: true; value: T } | Failure;
type User = Extract<DesiredProjection, { kind: "user"; deleted: false }>;
type Company = Extract<DesiredProjection, { kind: "organization"; deleted: false }>;
type Config = ReturnType<typeof readBrevoConfig>;
type Transport = (url: string, init: RequestInit) => Promise<Response>;
const contact = z.object({
  id: z.number().int().positive(),
  email: z.string(),
  emailBlacklisted: z.boolean(),
  smsBlacklisted: z.boolean(),
  attributes: z.object({
    EXT_ID: z.string(),
    EVERR_NAME: z.string().optional(),
    EVERR_REGISTERED_AT: z.string().optional(),
    EVERR_EMAIL_VERIFIED: z.boolean().optional(),
  }),
});
const company = z
  .object({
    name: z.string().optional(),
    id: z.string().min(1),
    attributes: z.object({
      name: z.string().optional(),
      everr_org_id: z.string().optional(),
      everr_created_at: z.string().optional(),
      everr_plan: z.string().optional(),
      everr_app_state: z.string().optional(),
      everr_subscription_status: z.string().optional(),
      everr_current_period_end: z.string().optional(),
      everr_cancel_at_period_end: z.string().optional(),
      everr_provisioning: z.string().optional(),
      everr_first_queryable_at: z.string().optional(),
      everr_activated_at: z.string().optional(),
      everr_activation_rule_version: z.string().optional(),
    }),
    linkedContactsIds: z.array(z.number().int()).optional(),
  })
  .transform(({ attributes: { name, ...attributes }, ...record }) => ({
    ...record,
    // Brevo returns its standard Company name inside attributes on reads.
    // Retain top-level compatibility for previously persisted owned reads.
    ...(name === undefined ? {} : { name }),
    attributes,
  }));
export type CompanyRecord = z.infer<typeof company>;
const failure = (kind: Failure["kind"], code: string, status?: number): Failure => ({
  ok: false,
  kind,
  code,
  ...(status === undefined ? {} : { status }),
});

function contactAttributes(snapshot: User) {
  return {
    EVERR_NAME: snapshot.fields.name,
    EVERR_REGISTERED_AT: snapshot.fields.registeredAt,
    EVERR_EMAIL_VERIFIED: snapshot.fields.emailVerified,
  };
}
function companyBody(snapshot: Company) {
  return {
    name: snapshot.fields.name,
    attributes: {
      everr_org_id: snapshot.externalId,
      everr_created_at: snapshot.fields.createdAt,
      everr_plan: snapshot.fields.plan,
      everr_app_state: snapshot.fields.appState,
      everr_subscription_status: snapshot.fields.subscriptionStatus ?? "",
      everr_current_period_end: snapshot.fields.currentPeriodEnd ?? "",
      everr_cancel_at_period_end: String(snapshot.fields.cancelAtPeriodEnd),
      everr_provisioning: snapshot.fields.provisioning,
      everr_first_queryable_at: snapshot.fields.firstQueryableAt ?? "",
      everr_activated_at: snapshot.fields.activatedAt ?? "",
      everr_activation_rule_version: snapshot.fields.activationRuleVersion?.toString() ?? "",
    },
  };
}

/** Read at most 256 KiB, including error responses. Never expose provider text. */
async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status === 204) return undefined;
  if (!response.body) throw new Error("Missing response.");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 262_144) throw new Error("Response limit.");
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(buffer));
}

function resetDelay(headers: Headers) {
  // Brevo documents reset as remaining seconds, not an epoch timestamp.
  const reset = Number(headers.get("x-sib-ratelimit-reset"));
  const retry = headers.get("retry-after");
  const seconds = retry === null ? NaN : Number(retry);
  const date = retry === null || Number.isFinite(seconds) ? NaN : Date.parse(retry);
  return Math.max(
    1000,
    Number.isFinite(reset) && reset > 0 ? reset * 1000 : 60_000,
    Number.isFinite(seconds) ? seconds * 1000 : 0,
    Number.isFinite(date) ? date - Date.now() : 0,
  );
}

/** Construction/import performs no I/O. Each call makes at most one attempt per request. */
export function createBrevoAdapter(
  config: Config,
  budget: BrevoBudget,
  transport: Transport = fetch,
) {
  async function request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Result<T>> {
    if (config.mode !== "configured") return failure(config.mode, `crm_${config.mode}`);
    if (signal?.aborted) return failure("cancelled", "request_cancelled");
    const group = path.startsWith("/contacts/") || path === "/contacts" ? "contacts" : "general";
    let permit: Awaited<ReturnType<BrevoBudget["acquire"]>>;
    try {
      permit = await budget.acquire(group);
      // Wait through the ordinary contact permit gap so a GET cannot starve its write.
      // Longer cooldowns return to durable scheduling without holding this task open.
      if (!permit.allowed && group === "contacts") {
        const waitMs = permit.retryAt.getTime() - Date.now();
        if (waitMs >= 0 && waitMs <= 250) {
          await delay(Math.min(250, waitMs + 1), undefined, { signal });
          permit = await budget.acquire(group);
        }
      }
    } catch {
      if (signal?.aborted) return failure("cancelled", "request_cancelled");
      return {
        ...failure("transient", "quota_unavailable"),
        retryAt: new Date(Date.now() + 60_000),
      };
    }
    if (!permit.allowed)
      return { ...failure("rate_limited", "local_budget"), retryAt: permit.retryAt };
    if (signal?.aborted) return failure("cancelled", "request_cancelled");
    const controller = new AbortController();
    let timedOut = false;
    let sent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new Error("Request stopped."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        onAbort();
      }, config.timeoutMs);
    });
    const create = method === "POST";
    let acceptedRemoteId: string | undefined;
    let responseFailure: Failure | undefined;
    try {
      const operation = async (): Promise<Result<T>> => {
        sent = true;
        const response = await transport(`https://api.brevo.com/v3${path}`, {
          method,
          headers: {
            "api-key": config.apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          redirect: "error",
          signal: controller.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const exhausted = response.headers.get("x-sib-ratelimit-remaining") === "0";
        const delay = resetDelay(response.headers);
        const readOutcome = async (): Promise<Result<T>> => {
          if (response.status === 429) {
            void response.body?.cancel().catch(() => undefined);
            return {
              ...failure("rate_limited", "provider_rate_limit", 429),
              retryAt: new Date(Date.now() + delay),
            };
          }
          if ([401, 403, 404, 409].includes(response.status)) {
            void response.body?.cancel().catch(() => undefined);
            if (response.status === 404) return failure("not_found", "remote_not_found", 404);
            if (response.status === 409)
              return failure("identity_conflict", "identity_conflict", 409);
            return failure("permanent", "credentials_rejected", response.status);
          }
          let json: unknown;
          try {
            json = await readJson(response, controller.signal);
          } catch {
            if (response.ok)
              return failure(
                create ? "ambiguous_create" : "transient",
                "invalid_response",
                response.status,
              );
          }
          if (response.ok && create) {
            const identity = z
              .object({
                id: z.union([
                  z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
                  z.number().int().positive(),
                ]),
              })
              .safeParse(json);
            if (identity.success) acceptedRemoteId = String(identity.data.id);
          }
          if (response.ok) {
            const parsed = schema.safeParse(json);
            return parsed.success
              ? { ok: true, value: parsed.data }
              : failure(
                  create ? "ambiguous_create" : "permanent",
                  "invalid_response",
                  response.status,
                );
          }
          const errorCode = z.object({ code: z.string() }).safeParse(json);
          if (
            response.status === 409 ||
            (errorCode.success &&
              ["duplicate_parameter", "duplicate_request"].includes(errorCode.data.code))
          )
            return failure("identity_conflict", "identity_conflict", response.status);
          if (response.status === 404) return failure("not_found", "remote_not_found", 404);
          if (response.status >= 500 || [408, 425].includes(response.status))
            return {
              ...failure(
                create ? "ambiguous_create" : "transient",
                "provider_unavailable",
                response.status,
              ),
              ...(create ? {} : { retryAt: new Date(Date.now() + 60_000) }),
            };
          return failure(
            "permanent",
            response.status === 401 || response.status === 403
              ? "credentials_rejected"
              : "provider_rejected",
            response.status,
          );
        };
        const result = await readOutcome();
        if (!result.ok) responseFailure = result;
        if (response.status === 429 || exhausted) await budget.cooldown(group, delay);
        return result;
      };
      return await Promise.race([operation(), aborted]);
    } catch {
      // No raw transport exception/cause, URL, body, credential or provider message escapes.
      // A known rejection remains definitive even if quota storage fails or stalls.
      if (responseFailure) return responseFailure;
      return {
        ...failure(
          create && sent ? "ambiguous_create" : signal?.aborted ? "cancelled" : "transient",
          timedOut
            ? "request_timeout"
            : signal?.aborted
              ? "request_cancelled"
              : "transport_failure",
        ),
        ...(signal?.aborted || (create && sent) ? {} : { retryAt: new Date(Date.now() + 60_000) }),
        ...(acceptedRemoteId === undefined ? {} : { remoteId: acceptedRemoteId }),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      controller.abort();
    }
  }
  function valid(snapshot: User | Company) {
    return (
      config.mode === "disabled" ||
      snapshot.externalId ===
        `everr:v1:${encodeURIComponent(config.deployment)}:${snapshot.kind}:${encodeURIComponent(snapshot.sourceId)}`
    );
  }
  async function getContact(externalId: string, signal?: AbortSignal) {
    return request(
      "GET",
      `/contacts/${encodeURIComponent(externalId)}?identifierType=ext_id`,
      contact,
      undefined,
      signal,
    );
  }
  return {
    getContact,
    async createContact(snapshot: User, signal?: AbortSignal) {
      if (!valid(snapshot)) return failure("permanent", "deployment_mismatch");
      return request(
        "POST",
        "/contacts",
        z.object({ id: z.number().int().positive() }),
        {
          email: snapshot.fields.email,
          ext_id: snapshot.externalId,
          attributes: contactAttributes(snapshot),
          updateEnabled: false,
          // Profile creation is never permission to market or start a welcome flow.
          emailBlacklisted: true,
          smsBlacklisted: true,
        },
        signal,
      );
    },
    /** Caller loads this record separately, under the entity synchronization lock. */
    async updateContact(
      snapshot: User,
      current: z.infer<typeof contact>,
      signal?: AbortSignal,
    ): Promise<Result<undefined> & { changed?: boolean }> {
      if (!valid(snapshot)) return failure("permanent", "deployment_mismatch");
      if (current.attributes.EXT_ID !== snapshot.externalId)
        return failure("identity_conflict", "external_id_mismatch");
      const emailChanged = current.email !== snapshot.fields.email;
      const attributes = Object.fromEntries(
        Object.entries(contactAttributes(snapshot)).filter(
          ([key, value]) =>
            Object.entries(current.attributes).find(([name]) => name === key)?.[1] !== value,
        ),
      );
      if (!emailChanged && Object.keys(attributes).length === 0)
        return { ok: true as const, value: undefined, changed: false };
      const result = await request(
        "PUT",
        `/contacts/${current.id}?identifierType=contact_id`,
        z.undefined(),
        {
          attributes: {
            ...attributes,
            ...(emailChanged ? { EMAIL: snapshot.fields.email } : {}),
          },
          forceMerge: false,
          // Never write false. Changing email is conservatively suppressed even if
          // the old address was allowed, including opt-outs concurrent with a read.
          ...(emailChanged || current.emailBlacklisted ? { emailBlacklisted: true } : {}),
          ...(current.smsBlacklisted ? { smsBlacklisted: true } : {}),
        },
        signal,
      );
      return result.ok ? { ...result, changed: true } : result;
    },
    deleteContact(remoteId: number, signal?: AbortSignal) {
      return request(
        "DELETE",
        `/contacts/${remoteId}?identifierType=contact_id`,
        z.undefined(),
        undefined,
        signal,
      );
    },
    getCompany(remoteId: string, signal?: AbortSignal) {
      return request(
        "GET",
        `/companies/${encodeURIComponent(remoteId)}`,
        company,
        undefined,
        signal,
      );
    },
    async createCompany(snapshot: Company, signal?: AbortSignal) {
      if (!valid(snapshot)) return failure("permanent", "deployment_mismatch");
      return request(
        "POST",
        "/companies",
        z.object({ id: z.string().min(1) }),
        companyBody(snapshot),
        signal,
      );
    },
    async updateCompany(
      snapshot: Company,
      current: CompanyRecord,
      signal?: AbortSignal,
    ): Promise<Result<CompanyRecord | undefined> & { changed?: boolean }> {
      if (!valid(snapshot)) return failure("permanent", "deployment_mismatch");
      if (current.attributes.everr_org_id !== snapshot.externalId)
        return failure("identity_conflict", "external_id_mismatch");
      const desired = companyBody(snapshot);
      const attributes = Object.fromEntries(
        Object.entries(desired.attributes).filter(
          ([key, value]) =>
            Object.entries(current.attributes).find(([name]) => name === key)?.[1] !== value,
        ),
      );
      const nameChanged = current.name !== desired.name;
      if (!nameChanged && Object.keys(attributes).length === 0)
        return { ok: true as const, value: undefined, changed: false };
      const result = await request(
        "PATCH",
        `/companies/${encodeURIComponent(current.id)}`,
        z.union([company, z.undefined()]),
        {
          ...(nameChanged ? { name: desired.name } : {}),
          ...(Object.keys(attributes).length ? { attributes } : {}),
        },
        signal,
      );
      return result.ok ? { ...result, changed: true } : result;
    },
    deleteCompany(remoteId: string, signal?: AbortSignal) {
      return request(
        "DELETE",
        `/companies/${encodeURIComponent(remoteId)}`,
        z.undefined(),
        undefined,
        signal,
      );
    },
    associate(companyId: string, contactId: number, linked: boolean, signal?: AbortSignal) {
      return request(
        "PATCH",
        `/companies/link-unlink/${encodeURIComponent(companyId)}`,
        z.undefined(),
        {
          [linked ? "linkContactIds" : "unlinkContactIds"]: [contactId],
        },
        signal,
      );
    },
    /** Bounded inventory, never assumes undocumented custom-attribute filtering. */
    async recoverCompany(
      externalId: string,
      signal?: AbortSignal,
    ): Promise<Result<z.infer<typeof company>>> {
      const result = await request(
        "GET",
        "/companies?limit=100",
        z.object({ items: z.array(company) }),
        undefined,
        signal,
      );
      if (!result.ok) return result;
      if (result.value.items.length >= 100)
        return failure("ambiguous_create", "recovery_inventory_limit");
      const matches = result.value.items.filter(
        (item) => item.attributes.everr_org_id === externalId,
      );
      if (matches.length > 1) return failure("identity_conflict", "multiple_remote_identities");
      if (matches.length === 1) return { ok: true, value: matches[0] };
      // No match is not permission to repeat a POST: visibility may be delayed.
      return failure("ambiguous_create", "recovery_not_visible");
    },
  };
}
