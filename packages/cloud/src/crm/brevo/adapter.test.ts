// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createBrevoAdapter } from "./adapter";
import type { BrevoBudget } from "./budget";
import { readBrevoConfig } from "./config";

const configured = readBrevoConfig({
  CRM_BREVO_MODE: "configured",
  CRM_BREVO_API_KEY: "secret-credential",
  CRM_BREVO_DEPLOYMENT: "test",
  CRM_BREVO_ACCOUNT_SCOPE: "account",
  CRM_BREVO_TIMEOUT_MS: "100",
});
const budget = (): BrevoBudget => ({
  acquire: vi.fn(async () => ({ allowed: true as const })),
  cooldown: vi.fn(async () => {}),
});
const user = {
  kind: "user",
  sourceId: "u",
  userId: "u",
  organizationId: null,
  externalId: "everr:v1:test:user:u",
  deleted: false,
  fields: {
    name: "Fixture",
    email: "fixture@example.com",
    registeredAt: "2026-01-01T00:00:00Z",
    emailVerified: true,
  },
  memberships: [],
} satisfies Parameters<ReturnType<typeof createBrevoAdapter>["createContact"]>[0];
const org = {
  kind: "organization",
  sourceId: "o",
  organizationId: "o",
  userId: null,
  externalId: "everr:v1:test:organization:o",
  deleted: false,
  fields: {
    name: "Fixture",
    createdAt: "2026-01-01T00:00:00Z",
    plan: "hobby",
    appState: "hobby",
    subscriptionStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    provisioning: "ready",
  },
  memberships: [],
} satisfies Parameters<ReturnType<typeof createBrevoAdapter>["createCompany"]>[0];
const current = {
  id: 42,
  email: "old@example.com",
  attributes: { EXT_ID: user.externalId },
  emailBlacklisted: true,
  smsBlacklisted: true,
};
const reply = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(status === 204 ? undefined : JSON.stringify(data), { status, headers });
afterEach(() => vi.useRealTimers());

it("omits unchanged owned fields and makes no write for an unchanged contact", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply(undefined, 204),
  );
  const adapter = createBrevoAdapter(configured, budget(), transport);
  const same = {
    ...current,
    email: user.fields.email,
    attributes: {
      EXT_ID: user.externalId,
      EVERR_NAME: user.fields.name,
      EVERR_REGISTERED_AT: user.fields.registeredAt,
      EVERR_EMAIL_VERIFIED: user.fields.emailVerified,
    },
  };
  expect(await adapter.updateContact(user, same)).toEqual({
    ok: true,
    value: undefined,
    changed: false,
  });
  expect(transport).not.toHaveBeenCalled();
  await adapter.updateContact({ ...user, fields: { ...user.fields, name: "Renamed" } }, same);
  expect(JSON.parse(transport.mock.calls[0][1].body as string).attributes).toEqual({
    EVERR_NAME: "Renamed",
  });
});

it("validates configured/paused settings without leaking values and keeps disabled startup inert", async () => {
  const transport = vi.fn();
  const quota = budget();
  const disabled = createBrevoAdapter(readBrevoConfig({}), quota, transport);
  expect(await disabled.createContact(user)).toMatchObject({ ok: false, kind: "disabled" });
  const paused = createBrevoAdapter(
    readBrevoConfig({
      CRM_BREVO_MODE: "paused",
      CRM_BREVO_API_KEY: "secret",
      CRM_BREVO_DEPLOYMENT: "test",
      CRM_BREVO_ACCOUNT_SCOPE: "account",
    }),
    quota,
    transport,
  );
  expect(await paused.deleteCompany("id")).toMatchObject({ ok: false, kind: "paused" });
  expect(quota.acquire).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
  expect(() =>
    readBrevoConfig({ CRM_BREVO_MODE: "configured", CRM_BREVO_API_KEY: "secret" }),
  ).toThrow("Invalid Brevo CRM configuration.");
  expect(() => readBrevoConfig({ CRM_BREVO_MODE: "paused" })).toThrow();
});

it.each([
  [500, "transient", "provider_unavailable"],
  [425, "transient", "provider_unavailable"],
  [401, "permanent", "credentials_rejected"],
  [403, "permanent", "credentials_rejected"],
  [400, "permanent", "provider_rejected"],
  [404, "not_found", "remote_not_found"],
  [409, "identity_conflict", "identity_conflict"],
])("classifies status %s without exposing response payloads", async (status, kind, code) => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply({ message: "secret-credential fixture@example.com" }, Number(status)),
  );
  const result = await createBrevoAdapter(configured, budget(), transport).getCompany("remote");
  expect(result).toMatchObject({ ok: false, kind, code, status });
  expect(JSON.stringify(result)).not.toContain("secret-credential");
  expect(JSON.stringify(result)).not.toContain("fixture@example.com");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("treats duplicate identifiers as conflicts and never enables update-or-merge creates", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply({ code: "duplicate_parameter", message: "payload" }, 400),
  );
  const result = await createBrevoAdapter(configured, budget(), transport).createContact(user);
  expect(result).toMatchObject({ kind: "identity_conflict" });
  const body = JSON.parse(transport.mock.calls[0][1].body as string);
  expect(body).toMatchObject({
    updateEnabled: false,
    emailBlacklisted: true,
    smsBlacklisted: true,
    ext_id: user.externalId,
  });
  expect(body).not.toHaveProperty("listIds");
});

it("honors local quota without HTTP or waiting and honors provider cooldown seconds and Retry-After", async () => {
  const quota = budget();
  vi.mocked(quota.acquire).mockResolvedValueOnce({
    allowed: false,
    retryAt: new Date(Date.now() + 36_000),
  });
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply({}, 429, { "x-sib-ratelimit-reset": "120", "Retry-After": "180" }),
  );
  const adapter = createBrevoAdapter(configured, quota, transport);
  expect(await adapter.getCompany("remote")).toMatchObject({
    kind: "rate_limited",
    code: "local_budget",
  });
  expect(transport).not.toHaveBeenCalled();
  expect(await adapter.getCompany("remote")).toMatchObject({ kind: "rate_limited", status: 429 });
  expect(quota.cooldown).toHaveBeenCalledWith("general", 180_000);
  expect(transport).toHaveBeenCalledTimes(1);
});

it("shares provider exhausted-capacity cooldown even on success", async () => {
  const quota = budget();
  const adapter = createBrevoAdapter(configured, quota, async () =>
    reply({ id: "remote", attributes: {} }, 200, {
      "x-sib-ratelimit-remaining": "0",
      "x-sib-ratelimit-reset": "72",
    }),
  );
  expect((await adapter.getCompany("remote")).ok).toBe(true);
  expect(quota.cooldown).toHaveBeenCalledWith("general", 72_000);
});

it.each([200, 401, 403, 404, 409])(
  "shares exhausted quota for malformed and definitive responses (%s)",
  async (status) => {
    const quota = budget();
    const result = await createBrevoAdapter(
      configured,
      quota,
      async () =>
        new Response("not JSON", {
          status,
          headers: { "x-sib-ratelimit-remaining": "0", "x-sib-ratelimit-reset": "72" },
        }),
    ).getCompany("remote");
    expect(result).toMatchObject({ ok: false, status });
    expect(quota.cooldown).toHaveBeenCalledWith("general", 72_000);
  },
);

it.each([401, 403, 404, 409])(
  "retains definitive create rejection when quota cooldown storage fails (%s)",
  async (status) => {
    const quota = budget();
    vi.mocked(quota.cooldown).mockRejectedValue(new Error("secret-credential"));
    const result = await createBrevoAdapter(configured, quota, async () =>
      reply({}, status, { "x-sib-ratelimit-remaining": "0" }),
    ).createCompany(org);
    expect(result).toEqual({
      ok: false,
      kind: status === 404 ? "not_found" : status === 409 ? "identity_conflict" : "permanent",
      code:
        status === 404
          ? "remote_not_found"
          : status === 409
            ? "identity_conflict"
            : "credentials_rejected",
      status,
    });
    expect(quota.cooldown).toHaveBeenCalledTimes(1);
  },
);

it("retains a definitive create rejection when quota cooldown storage stalls", async () => {
  vi.useFakeTimers();
  const quota = budget();
  vi.mocked(quota.cooldown).mockImplementation(() => new Promise(() => {}));
  const pending = createBrevoAdapter(configured, quota, async () =>
    reply({}, 401, { "x-sib-ratelimit-remaining": "0" }),
  ).createCompany(org);
  await vi.advanceTimersByTimeAsync(101);
  expect(await pending).toEqual({
    ok: false,
    kind: "permanent",
    code: "credentials_rejected",
    status: 401,
  });
  expect(quota.cooldown).toHaveBeenCalledTimes(1);
});

it("bounds transport and body stalls and aborts them, without automatic retries", async () => {
  vi.useFakeTimers();
  const transport = vi.fn((_url: string, init: RequestInit) => {
    expect(init.redirect).toBe("error");
    return new Promise<Response>(() => {});
  });
  const pending = createBrevoAdapter(configured, budget(), transport).createCompany(org);
  await vi.advanceTimersByTimeAsync(101);
  expect(await pending).toMatchObject({ kind: "ambiguous_create", code: "request_timeout" });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][1].signal?.aborted).toBe(true);
  const cancelBody = vi.fn();
  const stalled = createBrevoAdapter(
    configured,
    budget(),
    async () => new Response(new ReadableStream({ start() {}, cancel: cancelBody })),
  );
  const read = stalled.getCompany("remote");
  await vi.advanceTimersByTimeAsync(101);
  expect(await read).toMatchObject({ kind: "transient", code: "request_timeout" });
  expect(cancelBody).toHaveBeenCalledTimes(1);
});

it("cancels a stalled response body when the caller aborts", async () => {
  vi.useFakeTimers();
  const cancelBody = vi.fn();
  const controller = new AbortController();
  const pending = createBrevoAdapter(
    configured,
    budget(),
    async () => new Response(new ReadableStream({ start() {}, cancel: cancelBody })),
  ).getCompany("remote", controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await pending).toMatchObject({ kind: "cancelled", code: "request_cancelled" });
  expect(cancelBody).toHaveBeenCalledTimes(1);
});

it("handles preflight and in-flight cancellation without leaking exception causes", async () => {
  const controller = new AbortController();
  const transport = vi.fn(() => new Promise<Response>(() => {}));
  const adapter = createBrevoAdapter(configured, budget(), transport);
  controller.abort();
  expect(await adapter.getContact(user.externalId, controller.signal)).toMatchObject({
    kind: "cancelled",
  });
  expect(transport).not.toHaveBeenCalled();
  const inFlight = new AbortController();
  const pending = adapter.createContact(user, inFlight.signal);
  await Promise.resolve();
  inFlight.abort();
  expect(await pending).toMatchObject({ kind: "ambiguous_create", code: "request_cancelled" });
});

it("returns sanitized transport and quota errors, and makes uncertain creates inspectable", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    throw new Error("secret-credential email@example.com");
  });
  const adapter = createBrevoAdapter(configured, budget(), transport);
  expect(await adapter.createCompany(org)).toMatchObject({
    kind: "ambiguous_create",
    code: "transport_failure",
  });
  expect(await adapter.getCompany("remote")).toMatchObject({
    kind: "transient",
    code: "transport_failure",
  });
  const quota = budget();
  vi.mocked(quota.acquire).mockRejectedValue(new Error("secret-credential"));
  const result = await createBrevoAdapter(configured, quota, transport).getCompany("remote");
  expect(result).toMatchObject({ code: "quota_unavailable" });
  expect(JSON.stringify(result)).not.toContain("secret-credential");
});

it("preserves suppression and writes only owned profile fields across an email change", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply(undefined, 204),
  );
  const adapter = createBrevoAdapter(configured, budget(), transport);
  expect((await adapter.updateContact(user, current)).ok).toBe(true);
  const body = JSON.parse(transport.mock.calls[0][1].body as string);
  expect(body).toEqual({
    attributes: {
      EVERR_NAME: "Fixture",
      EVERR_REGISTERED_AT: user.fields.registeredAt,
      EVERR_EMAIL_VERIFIED: true,
      EMAIL: user.fields.email,
    },
    forceMerge: false,
    emailBlacklisted: true,
    smsBlacklisted: true,
  });
  expect(
    await adapter.updateContact(user, { ...current, attributes: { EXT_ID: "someone-else" } }),
  ).toMatchObject({ kind: "identity_conflict" });
  expect(transport).toHaveBeenCalledTimes(1);
});

it("never writes false suppression, consent, notes, preferences or association replacements", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply(undefined, 204),
  );
  const adapter = createBrevoAdapter(configured, budget(), transport);
  await adapter.updateContact(user, {
    ...current,
    email: user.fields.email,
    emailBlacklisted: false,
    smsBlacklisted: false,
  });
  expect(JSON.parse(transport.mock.calls[0][1].body as string)).toEqual({
    attributes: {
      EVERR_NAME: "Fixture",
      EVERR_REGISTERED_AT: user.fields.registeredAt,
      EVERR_EMAIL_VERIFIED: true,
    },
    forceMerge: false,
  });
  await adapter.associate("company", 42, true);
  await adapter.associate("company", 42, false);
  expect(JSON.parse(transport.mock.calls[1][1].body as string)).toEqual({ linkContactIds: [42] });
  expect(JSON.parse(transport.mock.calls[2][1].body as string)).toEqual({ unlinkContactIds: [42] });
});

it("recovers a lost company create response from bounded inventory despite misleading filters", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply({
      items: [
        { id: "other", attributes: { everr_org_id: "other" } },
        { id: "remote", attributes: { everr_org_id: org.externalId } },
      ],
    }),
  );
  const adapter = createBrevoAdapter(configured, budget(), transport);
  expect(await adapter.recoverCompany(org.externalId)).toMatchObject({
    ok: true,
    value: { id: "remote" },
  });
  expect(transport.mock.calls[0][0]).toBe("https://api.brevo.com/v3/companies?limit=100");
  expect(transport.mock.calls[0][1].method).toBe("GET");
});

it("blocks missing, duplicate and truncated recovery instead of permitting another create", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(reply({ items: [] }))
    .mockResolvedValueOnce(
      reply({
        items: [
          { id: "a", attributes: { everr_org_id: org.externalId } },
          { id: "b", attributes: { everr_org_id: org.externalId } },
        ],
      }),
    )
    .mockResolvedValueOnce(
      reply({ items: Array.from({ length: 100 }, (_, i) => ({ id: String(i), attributes: {} })) }),
    );
  const adapter = createBrevoAdapter(configured, budget(), transport);
  expect(await adapter.recoverCompany(org.externalId)).toMatchObject({
    kind: "ambiguous_create",
    code: "recovery_not_visible",
  });
  expect(await adapter.recoverCompany(org.externalId)).toMatchObject({ kind: "identity_conflict" });
  expect(await adapter.recoverCompany(org.externalId)).toMatchObject({
    kind: "ambiguous_create",
    code: "recovery_inventory_limit",
  });
});

it("rejects wrong deployment and bounds malformed or oversized responses", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply({ payload: "x".repeat(262145) }),
  );
  const adapter = createBrevoAdapter(configured, budget(), transport);
  expect(await adapter.createCompany({ ...org, externalId: "wrong" })).toMatchObject({
    code: "deployment_mismatch",
  });
  expect(transport).not.toHaveBeenCalled();
  expect(await adapter.createCompany(org)).toMatchObject({
    kind: "ambiguous_create",
    code: "invalid_response",
  });
});

it.each([400, 401, 403, 404, 409])(
  "retains definitive status %s for empty or non-JSON error bodies",
  async (status) => {
    const adapter = createBrevoAdapter(
      configured,
      budget(),
      async () => new Response("", { status }),
    );
    const result = await adapter.createCompany(org);
    expect(result).toMatchObject({
      kind: status === 404 ? "not_found" : status === 409 ? "identity_conflict" : "permanent",
      status,
    });
  },
);

it("does not retry accepted creates when cooldown persistence fails", async () => {
  const quota = budget();
  vi.mocked(quota.cooldown).mockRejectedValue(new Error("secret-credential"));
  const transport = vi.fn(async () =>
    reply({ id: "accepted" }, 200, {
      "x-sib-ratelimit-remaining": "0",
      "x-sib-ratelimit-reset": "45",
    }),
  );
  const result = await createBrevoAdapter(configured, quota, transport).createCompany(org);
  expect(result).toMatchObject({ kind: "ambiguous_create", remoteId: "accepted" });
  expect(JSON.stringify(result)).not.toContain("secret-credential");
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each([200, 204])(
  "supports documented 200 and verified 204 company update acknowledgements (%s)",
  async (status) => {
    const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      reply({ id: "remote", attributes: { everr_org_id: org.externalId } }, status),
    );
    const result = await createBrevoAdapter(configured, budget(), transport).updateCompany(org, {
      id: "remote",
      attributes: { everr_org_id: org.externalId },
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(transport.mock.calls[0][1].body as string);
    expect(body).toEqual({
      name: "Fixture",
      attributes: {
        everr_created_at: org.fields.createdAt,
        everr_plan: "hobby",
        everr_app_state: "hobby",
        everr_subscription_status: "",
        everr_current_period_end: "",
        everr_cancel_at_period_end: "false",
        everr_provisioning: "ready",
        everr_first_queryable_at: "",
        everr_activated_at: "",
        everr_activation_rule_version: "",
      },
    });
  },
);

it("conservatively suppresses a new email and preserves an existing SMS opt-out", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply(undefined, 204),
  );
  const result = await createBrevoAdapter(configured, budget(), transport).updateContact(user, {
    ...current,
    emailBlacklisted: false,
    smsBlacklisted: true,
  });
  expect(result.ok).toBe(true);
  expect(JSON.parse(transport.mock.calls[0][1].body as string)).toMatchObject({
    emailBlacklisted: true,
    smsBlacklisted: true,
  });
});

it("keeps ambiguous provider invalid_parameter failures blocked without guessing from prose", async () => {
  const result = await createBrevoAdapter(configured, budget(), async () =>
    reply(
      { code: "invalid_parameter", message: "Contact already exists, contains private values" },
      400,
    ),
  ).updateContact(user, current);
  expect(result).toEqual({ ok: false, kind: "permanent", code: "provider_rejected", status: 400 });
});

it("projects verified milestones as ISO text while preserving existing field ownership", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply(undefined, 204),
  );
  const result = await createBrevoAdapter(configured, budget(), transport).updateCompany(
    {
      ...org,
      fields: {
        ...org.fields,
        firstQueryableAt: "2026-10-23T12:00:00.123Z",
        activatedAt: "2026-10-23T12:00:00.123Z",
        activationRuleVersion: 1,
      },
    },
    { id: "remote", attributes: { everr_org_id: org.externalId } },
  );
  expect(result.ok).toBe(true);
  const body = JSON.parse(transport.mock.calls[0][1].body as string);
  expect(body.attributes).toMatchObject({
    everr_first_queryable_at: "2026-10-23T12:00:00.123Z",
    everr_activated_at: "2026-10-23T12:00:00.123Z",
    everr_activation_rule_version: "1",
    everr_plan: "hobby",
    everr_app_state: "hobby",
    everr_subscription_status: "",
    everr_provisioning: "ready",
  });
  expect(body.attributes).not.toHaveProperty("notes");
  expect(body).not.toHaveProperty("linkedContactsIds");
});

it("reads the provider's nested Company name and skips a redundant owned-field update", async () => {
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    reply({
      id: "remote",
      attributes: {
        name: org.fields.name,
        everr_org_id: org.externalId,
        everr_created_at: org.fields.createdAt,
        everr_plan: "hobby",
        everr_app_state: "hobby",
        everr_subscription_status: "",
        everr_current_period_end: "",
        everr_cancel_at_period_end: "false",
        everr_provisioning: "ready",
        everr_first_queryable_at: "",
        everr_activated_at: "",
        everr_activation_rule_version: "",
      },
    }),
  );
  const adapter = createBrevoAdapter(configured, budget(), transport);
  const read = await adapter.getCompany("remote");
  expect(read.ok).toBe(true);
  if (!read.ok) throw new Error("Expected owned Company read");
  expect(read.value.name).toBe(org.fields.name);
  expect(read.value.attributes).not.toHaveProperty("name");
  expect(await adapter.updateCompany(org, read.value)).toEqual({
    ok: true,
    value: undefined,
    changed: false,
  });
  expect(transport).toHaveBeenCalledOnce();
  const renamed = { ...org, fields: { ...org.fields, name: "Changed" } };
  await adapter.updateCompany(renamed, read.value);
  expect(JSON.parse(transport.mock.calls[1][1].body as string)).toEqual({ name: "Changed" });
});

it("normalizes provider Company names for inventory recovery and 200 update responses", async () => {
  const body = {
    id: "remote",
    name: "legacy",
    attributes: { name: "Provider", everr_org_id: org.externalId },
  };
  const transport = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(reply({ items: [body] }))
    .mockResolvedValueOnce(reply(body));
  const adapter = createBrevoAdapter(configured, budget(), transport);
  expect(await adapter.recoverCompany(org.externalId)).toMatchObject({
    ok: true,
    value: { name: "Provider" },
  });
  expect(
    await adapter.updateCompany(org, {
      id: "remote",
      attributes: { everr_org_id: org.externalId },
    }),
  ).toMatchObject({
    ok: true,
    value: { name: "Provider" },
  });
});

it("waits through a short contact permit gap before sending the request", async () => {
  vi.useFakeTimers();
  const quota = budget();
  vi.mocked(quota.acquire).mockResolvedValueOnce({
    allowed: false,
    retryAt: new Date(Date.now() + 100),
  });
  const transport = vi.fn(async () => reply(current));
  const pending = createBrevoAdapter(configured, quota, transport).getContact(user.externalId);
  await vi.advanceTimersByTimeAsync(100);
  expect(transport).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ ok: true, value: current });
  expect(quota.acquire).toHaveBeenCalledTimes(2);
  expect(transport).toHaveBeenCalledOnce();
});

it.each(["long contact cooldown", "general permit gap"])(
  "defers %s without waiting or sending HTTP",
  async (kind) => {
    vi.useFakeTimers();
    const quota = budget();
    const retryAt = new Date(Date.now() + (kind === "long contact cooldown" ? 60_000 : 100));
    vi.mocked(quota.acquire).mockResolvedValue({ allowed: false, retryAt });
    const transport = vi.fn();
    const adapter = createBrevoAdapter(configured, quota, transport);
    const result =
      kind === "long contact cooldown"
        ? await adapter.getContact(user.externalId)
        : await adapter.getCompany("remote");
    expect(result).toMatchObject({ ok: false, kind: "rate_limited", retryAt });
    expect(quota.acquire).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
  },
);

it("cancels a short contact permit wait before sending HTTP", async () => {
  const quota = budget();
  let entered!: () => void;
  const acquired = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(quota.acquire).mockImplementation(async () => {
    entered();
    return { allowed: false, retryAt: new Date(Date.now() + 200) };
  });
  const transport = vi.fn();
  const controller = new AbortController();
  const pending = createBrevoAdapter(configured, quota, transport).getContact(
    user.externalId,
    controller.signal,
  );
  await acquired;
  controller.abort();
  expect(await pending).toMatchObject({ ok: false, kind: "cancelled" });
  expect(quota.acquire).toHaveBeenCalledOnce();
  expect(transport).not.toHaveBeenCalled();
});
