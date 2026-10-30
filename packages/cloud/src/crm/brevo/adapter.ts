import { setTimeout as delay } from "node:timers/promises";
import * as z from "zod";
import { externalIdentity, type SourceSnapshot } from "../snapshots";
import { rateLimitDiagnostic } from "../telemetry";

type Failure = {
  ok: false;
  kind:
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
type User = Extract<SourceSnapshot, { kind: "user"; deleted: false }>;
type Company = Extract<SourceSnapshot, { kind: "organization"; deleted: false }>;
type Config = { apiKey: string; timeoutMs: number };
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
  const resetHeader = headers.get("x-sib-ratelimit-reset");
  const reset = resetHeader === null ? NaN : Number(resetHeader);
  const retry = headers.get("retry-after");
  const seconds = retry === null ? NaN : Number(retry);
  const date = retry === null || Number.isFinite(seconds) ? NaN : Date.parse(retry);
  const delays = [
    Number.isFinite(reset) && reset >= 0 ? reset * 1000 : undefined,
    Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined,
    Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined,
  ].filter((value): value is number => value !== undefined);
  return Math.max(1000, ...(delays.length ? delays : [60_000]));
}

/** Construction performs no I/O. Only explicit rate-limit rejections retry inside a call. */
export function createBrevoAdapter(
  config: Config,
  transport: Transport = fetch,
  rateLimited: (operation: string, waitMs: number) => void = rateLimitDiagnostic,
) {
  async function requestOnce<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Result<T>> {
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
        return result;
      };
      return await Promise.race([operation(), aborted]);
    } catch {
      // No raw transport exception/cause, URL, body, credential or provider message escapes.
      // Keep definitive provider rejections distinct from unknown transport outcomes.
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
  async function request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Result<T>> {
    while (true) {
      const result = await requestOnce(method, path, schema, body, signal);
      if (result.ok || result.kind !== "rate_limited") return result;
      const waitMs = Math.max(
        1000,
        (result.retryAt?.getTime() ?? Date.now() + 60_000) - Date.now(),
      );
      rateLimited(
        `${path.startsWith("/contacts") ? "contacts" : "companies"}.${method.toLowerCase()}`,
        waitMs,
      );
      try {
        await delay(waitMs, undefined, { signal });
      } catch {
        return failure("cancelled", "request_cancelled");
      }
    }
  }
  function valid(snapshot: User | Company) {
    return snapshot.externalId === externalIdentity(snapshot.kind, snapshot.sourceId);
  }
  const inventoryContact = z.object({
    id: z.number().int().positive(),
    attributes: z.object({ EXT_ID: z.string().optional() }),
  });
  async function listCompanies(signal?: AbortSignal): Promise<Result<CompanyRecord[]>> {
    const items = new Map<string, CompanyRecord>();
    for (let page = 1; ; page++) {
      const result = await request(
        "GET",
        `/companies?limit=100&page=${page}`,
        z.object({ items: z.array(company) }),
        undefined,
        signal,
      );
      if (!result.ok) return result;
      const size = items.size;
      for (const item of result.value.items) items.set(item.id, item);
      if (result.value.items.length < 100) return { ok: true, value: [...items.values()] };
      if (items.size === size) return failure("transient", "inventory_not_advancing");
    }
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
      if (!valid(snapshot)) return failure("permanent", "source_identity_mismatch");
      return request(
        "POST",
        "/contacts",
        z.object({ id: z.number().int().positive() }),
        {
          email: snapshot.fields.email,
          ext_id: snapshot.externalId,
          attributes: contactAttributes(snapshot),
          updateEnabled: false,
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
      if (!valid(snapshot)) return failure("permanent", "source_identity_mismatch");
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
      if (!valid(snapshot)) return failure("permanent", "source_identity_mismatch");
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
      if (!valid(snapshot)) return failure("permanent", "source_identity_mismatch");
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
    listCompanies,
    async listContacts(signal?: AbortSignal): Promise<Result<z.infer<typeof inventoryContact>[]>> {
      const items: z.infer<typeof inventoryContact>[] = [];
      for (let offset = 0; ; offset += 100) {
        const result = await request(
          "GET",
          `/contacts?limit=100&offset=${offset}`,
          z.object({ contacts: z.array(inventoryContact) }),
          undefined,
          signal,
        );
        if (!result.ok) return result;
        items.push(...result.value.contacts);
        if (result.value.contacts.length < 100) return { ok: true, value: items };
      }
    },
    async findCompany(
      externalId: string,
      signal?: AbortSignal,
    ): Promise<Result<CompanyRecord | undefined>> {
      const result = await listCompanies(signal);
      if (!result.ok) return result;
      const matches = result.value.filter((item) => item.attributes.everr_org_id === externalId);
      if (matches.length > 1) return failure("identity_conflict", "multiple_remote_identities");
      return { ok: true, value: matches[0] };
    },
  };
}

/** Only bounded, redacted classifications cross the provider seam. */
export class BrevoFailure extends Error {
  constructor(readonly failure: Failure) {
    super(`Brevo operation failed: ${failure.code}`);
  }
}
export function requireBrevo<T>(result: Result<T>): T {
  if (!result.ok) throw new BrevoFailure(result);
  return result.value;
}
