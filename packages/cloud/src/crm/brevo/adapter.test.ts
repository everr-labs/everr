// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createBrevoAdapter } from "./adapter";
import { readBrevoConfig } from "./config";

const config = readBrevoConfig({
  CRM_BREVO_MODE: "configured",
  CRM_BREVO_API_KEY: "secret",
  CRM_BREVO_TIMEOUT_MS: "100",
});
const user = {
  kind: "user",
  sourceId: "u",
  userId: "u",
  organizationId: null,
  externalId: "everr:v1:user:u",
  deleted: false,
  fields: {
    name: "Person",
    email: "person@example.test",
    registeredAt: "2026-01-01T00:00:00Z",
    emailVerified: true,
  },
  memberships: [],
} satisfies Parameters<ReturnType<typeof createBrevoAdapter>["createContact"]>[0];
const org = {
  kind: "organization",
  sourceId: "o",
  userId: null,
  organizationId: "o",
  externalId: "everr:v1:organization:o",
  deleted: false,
  fields: {
    name: "Team",
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
  email: user.fields.email,
  attributes: {
    EXT_ID: user.externalId,
    EVERR_NAME: user.fields.name,
    EVERR_REGISTERED_AT: user.fields.registeredAt,
    EVERR_EMAIL_VERIFIED: true,
  },
  emailBlacklisted: false,
  smsBlacklisted: true,
};
const transport = (response: Response) =>
  vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response);
afterEach(() => vi.useRealTimers());

it("keeps disabled and paused adapters inert without requiring namespaces", async () => {
  const fetch = vi.fn();
  expect(await createBrevoAdapter(readBrevoConfig({}), fetch).createContact(user)).toMatchObject({
    kind: "disabled",
  });
  expect(
    await createBrevoAdapter(
      readBrevoConfig({ CRM_BREVO_MODE: "paused", CRM_BREVO_API_KEY: "x" }),
      fetch,
    ).createContact(user),
  ).toMatchObject({ kind: "paused" });
  expect(fetch).not.toHaveBeenCalled();
});
it("omits unchanged fields and preserves opt-outs without touching unrelated fields", async () => {
  const fetch = transport(new Response(undefined, { status: 204 }));
  const adapter = createBrevoAdapter(config, fetch);
  expect(await adapter.updateContact(user, current)).toMatchObject({ ok: true, changed: false });
  expect(fetch).not.toHaveBeenCalled();
  await adapter.updateContact(
    { ...user, fields: { ...user.fields, email: "changed@example.test" } },
    current,
  );
  expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
    attributes: { EMAIL: "changed@example.test" },
    forceMerge: false,
    emailBlacklisted: true,
    smsBlacklisted: true,
  });
});
it("creates suppressed contacts with stable external identity and no enrollment", async () => {
  const fetch = transport(Response.json({ id: 1 }, { status: 201 }));
  await createBrevoAdapter(config, fetch).createContact(user);
  expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
    email: user.fields.email,
    ext_id: user.externalId,
    attributes: {
      EVERR_NAME: "Person",
      EVERR_REGISTERED_AT: user.fields.registeredAt,
      EVERR_EMAIL_VERIFIED: true,
    },
    updateEnabled: false,
    emailBlacklisted: true,
    smsBlacklisted: true,
  });
});
it.each([
  [400, "permanent"],
  [401, "permanent"],
  [403, "permanent"],
  [404, "not_found"],
  [409, "identity_conflict"],
  [500, "transient"],
  [425, "transient"],
])("classifies %s with redacted failures", async (status, kind) => {
  const fetch = transport(
    Response.json({ code: "error", detail: "private-profile" }, { status: Number(status) }),
  );
  const result = await createBrevoAdapter(config, fetch).getCompany("c");
  expect(result).toMatchObject({ ok: false, kind, status });
  expect(JSON.stringify(result)).not.toMatch(/private-profile|secret/);
  expect(fetch).toHaveBeenCalledOnce();
});
it("does not repeat a Company POST after an accepted response is lost", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("private transport detail");
  });
  expect(await createBrevoAdapter(config, fetch).createCompany(org)).toMatchObject({
    kind: "ambiguous_create",
  });
  expect(fetch).toHaveBeenCalledOnce();
});
it.each([200, 204])("accepts Company PATCH acknowledgment %s", async (status) => {
  const fetch = transport(
    status === 204
      ? new Response(undefined, { status })
      : Response.json({ id: "c", attributes: { name: "Team", everr_org_id: org.externalId } }),
  );
  expect(
    await createBrevoAdapter(config, fetch).updateCompany(org, {
      id: "c",
      name: "Old",
      attributes: { everr_org_id: org.externalId },
    }),
  ).toMatchObject({ ok: true });
});
it("waits through repeated 429 responses without exposing them as failed attempts", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(
      new Response(undefined, {
        status: 429,
        headers: { "retry-after": "2", "x-sib-ratelimit-reset": "1" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(undefined, {
        status: 429,
        headers: { "retry-after": "1", "x-sib-ratelimit-reset": "1" },
      }),
    )
    .mockResolvedValueOnce(Response.json({ id: "c", attributes: {} }));
  const diagnostic = vi.fn();
  const result = createBrevoAdapter(config, fetch, diagnostic).getCompany("c");
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1001);
  expect(await result).toMatchObject({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(diagnostic.mock.calls).toEqual([
    ["companies.get", 2000],
    ["companies.get", 1000],
  ]);
});
it("cancels backpressure promptly without another request", async () => {
  const controller = new AbortController();
  const fetch = transport(new Response(undefined, { status: 429 }));
  const diagnostic = vi.fn(() => controller.abort());
  expect(
    await createBrevoAdapter(config, fetch, diagnostic).getCompany("c", controller.signal),
  ).toMatchObject({ kind: "cancelled" });
  expect(fetch).toHaveBeenCalledOnce();
});
it("bounds a stalled transport and classifies an uncertain create", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  const adapter = createBrevoAdapter(config, fetch);
  const read = adapter.getCompany("c");
  const create = adapter.createCompany(org);
  await vi.advanceTimersByTimeAsync(100);
  expect(await read).toMatchObject({ kind: "transient", code: "request_timeout" });
  expect(await create).toMatchObject({ kind: "ambiguous_create", code: "request_timeout" });
});
it("bounds oversized response bodies", async () => {
  const fetch = transport(new Response('"' + "x".repeat(262145) + '"'));
  expect(await createBrevoAdapter(config, fetch).getCompany("c")).toMatchObject({
    ok: false,
    code: "invalid_response",
  });
});
it("paginates Company lookup and rejects duplicate identities across pages", async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ id: `foreign-${i}`, attributes: {} }));
  const fetch = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(Response.json({ items: page }))
    .mockResolvedValueOnce(
      Response.json({
        items: [{ id: "c", attributes: { name: "Team", everr_org_id: org.externalId } }],
      }),
    );
  expect(await createBrevoAdapter(config, fetch).findCompany(org.externalId)).toMatchObject({
    ok: true,
    value: { id: "c", name: "Team" },
  });
  expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get("page"))).toEqual([
    "1",
    "2",
  ]);
  const duplicates = transport(
    Response.json({
      items: [
        { id: "a", attributes: { everr_org_id: org.externalId } },
        { id: "b", attributes: { everr_org_id: org.externalId } },
      ],
    }),
  );
  expect(await createBrevoAdapter(config, duplicates).findCompany(org.externalId)).toMatchObject({
    kind: "identity_conflict",
  });
});
it("paginates Contact inventory with offsets and accepts foreign identities", async () => {
  const fetch = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(
      Response.json({
        contacts: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, attributes: {} })),
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ contacts: [{ id: 101, attributes: { EXT_ID: user.externalId } }] }),
    );
  expect(await createBrevoAdapter(config, fetch).listContacts()).toMatchObject({
    ok: true,
    value: expect.any(Array),
  });
  expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get("offset"))).toEqual([
    "0",
    "100",
  ]);
});
it("rejects forged source and remote identities before writes", async () => {
  const fetch = vi.fn();
  const adapter = createBrevoAdapter(config, fetch);
  expect(await adapter.createContact({ ...user, externalId: "foreign" })).toMatchObject({
    ok: false,
  });
  expect(
    await adapter.updateContact(user, { ...current, attributes: { EXT_ID: "foreign" } }),
  ).toMatchObject({ kind: "identity_conflict" });
  expect(
    await adapter.updateCompany(org, { id: "c", attributes: { everr_org_id: "foreign" } }),
  ).toMatchObject({ kind: "identity_conflict" });
  expect(fetch).not.toHaveBeenCalled();
});

it("honors Retry-After without adding a fallback minute when the reset header is absent", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(
      new Response(undefined, { status: 429, headers: { "retry-after": "1" } }),
    )
    .mockResolvedValueOnce(Response.json({ id: "c", attributes: {} }));
  const diagnostic = vi.fn();
  const operation = createBrevoAdapter(config, fetch, diagnostic).getCompany("c");
  await vi.advanceTimersByTimeAsync(1000);
  expect(await operation).toMatchObject({ ok: true });
  expect(diagnostic).toHaveBeenCalledWith("companies.get", 1000);
});

it("reports a non-advancing Company inventory instead of holding the queue forever", async () => {
  const items = Array.from({ length: 100 }, (_, id) => ({ id: `c-${id}`, attributes: {} }));
  const fetch = vi.fn(async () => Response.json({ items }));
  expect(await createBrevoAdapter(config, fetch).listCompanies()).toMatchObject({
    kind: "transient",
    code: "inventory_not_advancing",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
