// @vitest-environment node
import type { Database } from "@everr/app/db/database";
import { member, organization, user } from "@everr/app/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { eq } from "drizzle-orm";
import type { JobHelpers } from "graphile-worker";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { createBrevoAdapter } from "./brevo/adapter";
import { readBrevoConfig } from "./brevo/config";
import {
  FULL_SYNC_TASK,
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  CRM_QUEUE,
  userSyncSpec,
  relatedSyncSpec,
  fullSyncSpec,
} from "./commands";
import { COMPANY_ID_METADATA, saveCompanyId } from "./metadata";
import { createCrmSnapshotReader } from "./snapshots";
import { createCrmTaskList } from "./task-list";
import { membershipChanged } from "@everr/app/identity/events";
import { crmEventRoutes } from "./jobs";

vi.mock("@everr/app/db/client", () => ({ db: undefined }));
vi.mock("../app/env", () => ({ appEnv: { POLAR_PRO_PRODUCT_ID: "product_pro" } }));
let fixture: TestDatabase;
let database: Database;
beforeAll(async () => {
  fixture = await createTestDatabase([
    {
      migrationsFolder: `${import.meta.dirname}/../drizzle`,
      migrationsTable: "__everr_cloud_migrations",
      migrationsSchema: "drizzle",
    },
  ]);
  database = fixture.db as unknown as Database;
});
afterAll(() => fixture.close());
beforeEach(async () => {
  await fixture.truncate();
  await fixture.db.insert(user).values({ id: "u", name: "User", email: "user@example.test" });
  await fixture.db.insert(organization).values({
    id: "o",
    name: "Team",
    slug: "team",
    createdAt: new Date(),
    metadata: JSON.stringify({ label: "preserved", clickhouseReady: false }),
  });
  await fixture.db
    .insert(member)
    .values({ id: "m", userId: "u", organizationId: "o", role: "owner", createdAt: new Date() });
});

type RemoteCompany = {
  id: string;
  name: string;
  attributes: Record<string, string>;
  linkedContactsIds: number[];
};
type RemoteContact = {
  id: number;
  email: string;
  attributes: Record<string, string | boolean>;
  emailBlacklisted: boolean;
  smsBlacklisted: boolean;
};
function state() {
  const companies = new Map<string, RemoteCompany>();
  const contacts = new Map<string, RemoteContact>();
  let nextCompany = 1,
    nextContact = 1;
  const hooks = {
    loseCreate: false,
    losePatch: false,
    failStatus: 0,
    after: undefined as undefined | ((method: string, path: string) => Promise<void>),
  };
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url),
      path = parsed.pathname.replace("/v3", ""),
      method = init.method!;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (hooks.failStatus) return new Response("{}", { status: hooks.failStatus });
    let response: Response;
    if (path === "/companies" && method === "GET")
      response = Response.json({
        items: [...companies.values()].slice(
          (Number(parsed.searchParams.get("page")) - 1) * 100,
          Number(parsed.searchParams.get("page")) * 100,
        ),
      });
    else if (path === "/contacts" && method === "GET")
      response = Response.json({
        contacts: [...contacts.values()].slice(
          Number(parsed.searchParams.get("offset")),
          Number(parsed.searchParams.get("offset")) + 100,
        ),
      });
    else if (path === "/companies" && method === "POST") {
      const id = `company-${nextCompany++}`;
      companies.set(id, { id, ...body, linkedContactsIds: [] });
      if (hooks.loseCreate) {
        hooks.loseCreate = false;
        throw new Error("lost accepted create");
      }
      response = Response.json({ id }, { status: 201 });
    } else if (path === "/contacts" && method === "POST") {
      const id = nextContact++;
      contacts.set(body.ext_id, {
        id,
        email: body.email,
        attributes: { EXT_ID: body.ext_id, ...body.attributes },
        emailBlacklisted: body.emailBlacklisted ?? false,
        smsBlacklisted: body.smsBlacklisted ?? false,
      });
      response = Response.json({ id }, { status: 201 });
    } else if (path.startsWith("/companies/link-unlink/")) {
      const company = companies.get(path.split("/").at(-1)!)!;
      company.linkedContactsIds = body.linkContactIds
        ? [...new Set([...company.linkedContactsIds, ...body.linkContactIds])]
        : company.linkedContactsIds.filter((id) => !body.unlinkContactIds.includes(id));
      response = new Response(undefined, { status: 204 });
    } else if (path.startsWith("/companies/")) {
      const company = companies.get(path.split("/").at(-1)!);
      if (!company) response = new Response(undefined, { status: 404 });
      else if (method === "GET") response = Response.json(company);
      else if (method === "DELETE") {
        companies.delete(company.id);
        response = new Response(undefined, { status: 204 });
      } else {
        Object.assign(company, {
          ...(body.name ? { name: body.name } : {}),
          attributes: { ...company.attributes, ...body.attributes },
        });
        if (hooks.losePatch) {
          hooks.losePatch = false;
          throw new Error("lost accepted patch");
        }
        response = new Response(undefined, { status: 204 });
      }
    } else if (path.startsWith("/contacts/")) {
      const contact =
        method === "GET"
          ? contacts.get(decodeURIComponent(path.slice("/contacts/".length)))
          : [...contacts.values()].find((contact) => contact.id === Number(path.split("/").at(-1)));
      if (!contact) response = new Response(undefined, { status: 404 });
      else if (method === "GET") response = Response.json(contact);
      else if (method === "DELETE") {
        contacts.delete(String(contact.attributes.EXT_ID));
        for (const company of companies.values())
          company.linkedContactsIds = company.linkedContactsIds.filter((id) => id !== contact.id);
        response = new Response(undefined, { status: 204 });
      } else {
        if (body.attributes.EMAIL) contact.email = body.attributes.EMAIL;
        Object.assign(contact.attributes, body.attributes);
        response = new Response(undefined, { status: 204 });
      }
    } else throw new Error("Unexpected controlled request");
    await hooks.after?.(method, path);
    return response;
  });
  const adapter = createBrevoAdapter(
    readBrevoConfig({ CRM_BREVO_MODE: "configured", CRM_BREVO_API_KEY: "fixture" }),
    transport,
  );
  const reader = createCrmSnapshotReader(database);
  const diagnostic = vi.fn();
  const tasks = createCrmTaskList({ database, reader, adapter, diagnostic });
  const queued: { task: string; body: unknown; spec: unknown }[] = [];
  const addJob = vi.fn(async (task: string, body: unknown, spec: unknown) => {
    queued.push({ task, body, spec });
  });
  const origin = {
    version: 1,
    eventId: "test",
    eventType: "organization.updated",
    occurredAt: new Date().toISOString(),
  };
  async function invoke(task: string, body?: unknown, attempt = 1) {
    const payload =
      body ??
      (task === USER_SYNC_TASK
        ? { ...origin, userId: "u" }
        : task === MEMBERSHIP_SYNC_TASK
          ? { ...origin, kind: "membership", userId: "u", organizationId: "o" }
          : { ...origin, kind: "organization", organizationId: "o" });
    await tasks[task]!(payload, {
      addJob,
      job: { id: "test", task_identifier: task, attempts: attempt, max_attempts: 8 },
    } as unknown as JobHelpers);
  }
  return {
    companies,
    contacts,
    hooks,
    transport,
    adapter,
    reader,
    diagnostic,
    queued,
    addJob,
    invoke,
    origin,
  };
}

it("synchronizes current User, Company and pair repeatedly without duplicate records or link writes", async () => {
  const s = state();
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  expect(s.contacts.size).toBe(1);
  expect(s.companies.size).toBe(1);
  expect(s.companies.get("company-1")!.linkedContactsIds).toEqual([1]);
  expect(s.transport.mock.calls.filter(([url]) => url.includes("link-unlink"))).toHaveLength(1);
  const [row] = await fixture.db.select().from(organization);
  expect(JSON.parse(row.metadata!)).toEqual({
    label: "preserved",
    clickhouseReady: false,
    [COMPANY_ID_METADATA]: "company-1",
  });
  expect(s.companies.get("company-1")!.attributes.everr_provisioning).toBe("pending");
});
it.each(["foreign", "missing"])(
  "repairs a %s Company mapping in the current account",
  async (kind) => {
    const s = state();
    await saveCompanyId(database, "o", "copied-id");
    if (kind === "foreign")
      s.companies.set("copied-id", {
        id: "copied-id",
        name: "Untouched",
        attributes: { everr_org_id: "someone-else" },
        linkedContactsIds: [],
      });
    s.companies.set("right", {
      id: "right",
      name: "Old",
      attributes: { everr_org_id: "everr:v1:organization:o" },
      linkedContactsIds: [],
    });
    await s.invoke(ORGANIZATION_SYNC_TASK);
    expect(await s.reader.organization("o")).toMatchObject({ companyId: "right" });
    expect(s.companies.get("copied-id")?.name).toBe(kind === "foreign" ? "Untouched" : undefined);
    expect(
      s.transport.mock.calls.some(
        ([url, init]) => url.endsWith("/companies") && init.method === "POST",
      ),
    ).toBe(false);
  },
);
it("recovers an accepted Company create manually without repeating POST", async () => {
  const s = state();
  s.hooks.loseCreate = true;
  await s.invoke(ORGANIZATION_SYNC_TASK);
  expect(s.diagnostic).toHaveBeenLastCalledWith(
    "failed",
    expect.anything(),
    "test",
    expect.objectContaining({ code: "transport_failure" }),
  );
  expect(await s.reader.organization("o")).not.toHaveProperty("companyId", "company-1");
  await s.invoke(ORGANIZATION_SYNC_TASK);
  expect(s.companies.size).toBe(1);
  expect(await s.reader.organization("o")).toMatchObject({ companyId: "company-1" });
});
it("rereads remote state after an accepted PATCH with a lost response and source reversal", async () => {
  const s = state();
  await s.invoke(ORGANIZATION_SYNC_TASK);
  await fixture.db.update(organization).set({ name: "Changed" }).where(eq(organization.id, "o"));
  s.hooks.losePatch = true;
  await expect(s.invoke(ORGANIZATION_SYNC_TASK)).rejects.toThrow("CRM synchronization failed");
  await fixture.db.update(organization).set({ name: "Team" }).where(eq(organization.id, "o"));
  await s.invoke(ORGANIZATION_SYNC_TASK);
  expect(s.companies.get("company-1")!.name).toBe("Team");
});
it("cleans missing sources after cascades without retained mapping tables", async () => {
  const s = state();
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  await fixture.db.delete(organization).where(eq(organization.id, "o"));
  await s.invoke(ORGANIZATION_SYNC_TASK);
  await s.invoke(ORGANIZATION_SYNC_TASK);
  expect(s.companies.size).toBe(0);
  await fixture.db.delete(user).where(eq(user.id, "u"));
  await s.invoke(USER_SYNC_TASK);
  expect(s.contacts.size).toBe(0);
});
it("unlinks a removed pair without creating absent parents", async () => {
  const s = state();
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  await fixture.db.delete(member).where(eq(member.id, "m"));
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  expect(s.companies.get("company-1")!.linkedContactsIds).toEqual([]);
  expect(s.contacts.size).toBe(1);
});
it("captures a deletion committed during HTTP and queues current-state cleanup", async () => {
  const s = state();
  s.hooks.after = async (method, path) => {
    if (method === "POST" && path === "/companies")
      await fixture.db.delete(organization).where(eq(organization.id, "o"));
  };
  await s.invoke(ORGANIZATION_SYNC_TASK);
  expect(s.queued).toEqual(
    expect.arrayContaining([expect.objectContaining({ task: ORGANIZATION_SYNC_TASK })]),
  );
  s.hooks.after = undefined;
  await s.invoke(ORGANIZATION_SYNC_TASK);
  expect(s.companies.size).toBe(0);
});
it("uses the refreshed source after provider lookup instead of creating a deleted User", async () => {
  const s = state();
  const get = vi.spyOn(s.adapter, "getContact").mockImplementationOnce(async () => {
    await fixture.db.delete(user).where(eq(user.id, "u"));
    return { ok: false, kind: "not_found", code: "remote_not_found" };
  });
  await s.invoke(USER_SYNC_TASK);
  expect(s.contacts.size).toBe(0);
  get.mockRestore();
});
it("separates native retries, exhausted attempts and terminal errors without leaking provider text", async () => {
  const s = state();
  s.hooks.failStatus = 500;
  await expect(s.invoke(USER_SYNC_TASK)).rejects.toThrow("provider_unavailable");
  expect(s.diagnostic).toHaveBeenLastCalledWith(
    "retry",
    expect.anything(),
    "test",
    expect.objectContaining({ attempt: 1, nextAttemptAt: expect.any(String) }),
  );
  await expect(s.invoke(USER_SYNC_TASK, undefined, 8)).rejects.toThrow();
  expect(s.diagnostic).toHaveBeenLastCalledWith(
    "exhausted",
    expect.anything(),
    "test",
    expect.anything(),
  );
  s.hooks.failStatus = 401;
  await s.invoke(USER_SYNC_TASK);
  expect(s.diagnostic).toHaveBeenLastCalledWith(
    "failed",
    expect.anything(),
    "test",
    expect.objectContaining({ code: "credentials_rejected" }),
  );
});
it("rejects malformed commands before source or provider work", async () => {
  const s = state();
  await s.invoke(USER_SYNC_TASK, { ...s.origin, userId: "u", email: "private" });
  expect(s.transport).not.toHaveBeenCalled();
  expect(s.diagnostic).toHaveBeenLastCalledWith("invalid", undefined, "test", {
    code: "invalid_command",
  });
});
it("blocks duplicate Company identities without updating or creating either", async () => {
  const s = state();
  for (const id of ["a", "b"])
    s.companies.set(id, {
      id,
      name: "Untouched",
      attributes: { everr_org_id: "everr:v1:organization:o" },
      linkedContactsIds: [],
    });
  await s.invoke(ORGANIZATION_SYNC_TASK);
  expect([...s.companies.values()].map((company) => company.name)).toEqual([
    "Untouched",
    "Untouched",
  ]);
  expect(s.diagnostic).toHaveBeenLastCalledWith(
    "failed",
    expect.anything(),
    "test",
    expect.objectContaining({ code: "multiple_remote_identities" }),
  );
});
it("previews prune without writes and applies only Everr-owned orphan and obsolete pair commands", async () => {
  const s = state();
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  s.queued.length = 0;
  s.transport.mockClear();
  s.contacts.set("foreign", {
    id: 2,
    email: "foreign",
    attributes: { EXT_ID: "foreign" },
    emailBlacklisted: false,
    smsBlacklisted: false,
  });
  s.contacts.set("everr:v1:user:gone", {
    id: 3,
    email: "gone",
    attributes: { EXT_ID: "everr:v1:user:gone" },
    emailBlacklisted: true,
    smsBlacklisted: true,
  });
  s.companies.get("company-1")!.linkedContactsIds = [1, 2, 3];
  s.companies.set("foreign", {
    id: "foreign",
    name: "Foreign",
    attributes: {},
    linkedContactsIds: [1],
  });
  s.companies.set("gone", {
    id: "gone",
    name: "Gone",
    attributes: { everr_org_id: "everr:v1:organization:gone" },
    linkedContactsIds: [],
  });
  await fixture.db.delete(member).where(eq(member.id, "m"));
  const payload = { ...s.origin, eventType: "crm.full-sync.requested", prune: true, apply: false };
  await s.invoke(FULL_SYNC_TASK, payload);
  expect(s.queued).toEqual([]);
  expect(s.transport.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  await s.invoke(FULL_SYNC_TASK, { ...payload, apply: true });
  const queued = [...s.queued];
  s.queued.length = 0;
  for (const job of queued) await s.invoke(job.task, job.body);
  expect(s.contacts.has("foreign")).toBe(true);
  expect(s.contacts.has("everr:v1:user:gone")).toBe(false);
  expect(s.companies.has("foreign")).toBe(true);
  expect(s.companies.has("gone")).toBe(false);
  expect(s.companies.get("company-1")!.linkedContactsIds).toEqual([2]);
});
it("rechecks a prune candidate at execution and preserves a pair added after preview", async () => {
  const s = state();
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  await fixture.db.delete(member).where(eq(member.id, "m"));
  await s.invoke(FULL_SYNC_TASK, {
    ...s.origin,
    eventType: "crm.full-sync.requested",
    prune: true,
    apply: true,
  });
  await fixture.db.insert(member).values({
    id: "new-m",
    userId: "u",
    organizationId: "o",
    role: "owner",
    createdAt: new Date(),
  });
  const candidate = s.queued.find((job) => job.task === MEMBERSHIP_SYNC_TASK)!;
  await s.invoke(candidate.task, candidate.body);
  expect(s.companies.get("company-1")!.linkedContactsIds).toEqual([1]);
});
it("manual full sync admits sources into the same queue and can restart from scratch", async () => {
  const s = state();
  const payload = { ...s.origin, eventType: "crm.full-sync.requested", prune: false, apply: false };
  await s.invoke(FULL_SYNC_TASK, payload);
  await s.invoke(FULL_SYNC_TASK, payload);
  expect(s.queued).toHaveLength(4);
  expect(s.transport).not.toHaveBeenCalled();
  expect(
    [userSyncSpec("u"), relatedSyncSpec("o"), relatedSyncSpec("o", "u"), fullSyncSpec()].every(
      (spec) => spec.queueName === CRM_QUEUE && spec.maxAttempts === 8,
    ),
  ).toBe(true);
});

it("preserves foreign links added after prune admission and reports blocked orphan cleanup", async () => {
  const s = state();
  s.contacts.set("everr:v1:user:gone", {
    id: 3,
    email: "gone",
    attributes: { EXT_ID: "everr:v1:user:gone" },
    emailBlacklisted: true,
    smsBlacklisted: true,
  });
  s.companies.set("gone", {
    id: "gone",
    name: "Orphan",
    attributes: { everr_org_id: "everr:v1:organization:gone" },
    linkedContactsIds: [],
  });
  await s.invoke(FULL_SYNC_TASK, {
    ...s.origin,
    eventType: "crm.full-sync.requested",
    prune: true,
    apply: true,
  });
  const orphans = s.queued.filter(
    (job) =>
      (job.body as { userId?: string; organizationId?: string }).userId === "gone" ||
      (job.body as { organizationId?: string }).organizationId === "gone",
  );
  expect(orphans).toHaveLength(2);
  s.contacts.set("foreign", {
    id: 2,
    email: "foreign",
    attributes: { EXT_ID: "foreign" },
    emailBlacklisted: false,
    smsBlacklisted: false,
  });
  s.companies.set("foreign", {
    id: "foreign",
    name: "Foreign",
    attributes: {},
    linkedContactsIds: [3],
  });
  s.companies.get("gone")!.linkedContactsIds = [2];
  for (const job of orphans) await s.invoke(job.task, job.body);
  expect(s.contacts.has("everr:v1:user:gone")).toBe(true);
  expect(s.companies.get("foreign")!.linkedContactsIds).toEqual([3]);
  expect(s.companies.get("gone")!.linkedContactsIds).toEqual([2]);
  expect(
    s.diagnostic.mock.calls.filter(
      ([outcome, , , details]) =>
        outcome === "failed" && details?.code === "foreign_associations_present",
    ),
  ).toHaveLength(2);
  s.queued.length = 0;
  await s.invoke(FULL_SYNC_TASK, {
    ...s.origin,
    eventType: "crm.full-sync.requested",
    prune: true,
    apply: false,
  });
  expect(s.queued).toEqual([]);
  expect(
    s.diagnostic.mock.calls.filter(
      ([outcome, , , details]) =>
        outcome === "failed" && details?.code === "foreign_associations_present",
    ),
  ).toHaveLength(4);
});

it.each([false, true])(
  "synchronizes both Membership endpoints and preserves a previous pair still present (%s)",
  async (keepPrevious) => {
    const s = state();
    await s.invoke(MEMBERSHIP_SYNC_TASK);
    await fixture.db.insert(user).values({ id: "v", name: "Other", email: "other@example.test" });
    await fixture.db
      .insert(organization)
      .values({ id: "p", name: "New Team", slug: "new-team", createdAt: new Date() });
    await fixture.db
      .update(member)
      .set({ userId: "v", organizationId: "p" })
      .where(eq(member.id, "m"));
    if (keepPrevious)
      await fixture.db.insert(member).values({
        id: "other-membership",
        userId: "u",
        organizationId: "o",
        role: "member",
        createdAt: new Date(),
      });
    const fact = membershipChanged(
      "membership.updated",
      { id: "m", userId: "v", organizationId: "p" },
      { userId: "u", organizationId: "o" },
    );
    const route = crmEventRoutes("configured").find(
      (route) => route.definition.type === "membership.updated",
    )!;
    const job = route.job({ ...fact, id: "move-1", occurredAt: new Date().toISOString() });
    await s.invoke(job.task, job.payload);
    await s.invoke(job.task, job.payload);
    expect(s.companies.get("company-1")!.linkedContactsIds).toEqual(keepPrevious ? [1] : []);
    expect(s.companies.get("company-2")!.linkedContactsIds).toEqual([2]);
    expect(s.contacts.size).toBe(2);
    expect(s.companies.size).toBe(2);
    expect(s.diagnostic.mock.calls.every(([outcome]) => outcome === "synced")).toBe(true);
  },
);
it("cleans every previous pair across moves queued before execution", async () => {
  const s = state();
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  for (const id of ["p", "q"])
    await fixture.db.insert(organization).values({ id, name: id, slug: id, createdAt: new Date() });
  await fixture.db.update(member).set({ organizationId: "p" }).where(eq(member.id, "m"));
  await s.invoke(MEMBERSHIP_SYNC_TASK, {
    ...s.origin,
    kind: "membership",
    userId: "u",
    organizationId: "p",
  });
  await fixture.db.update(member).set({ organizationId: "q" }).where(eq(member.id, "m"));
  for (const [previous, organizationId] of [
    ["o", "p"],
    ["p", "q"],
  ])
    await s.invoke(MEMBERSHIP_SYNC_TASK, {
      ...s.origin,
      kind: "membership",
      userId: "u",
      organizationId,
      previous: { userId: "u", organizationId: previous },
    });
  expect(s.companies.get("company-1")!.linkedContactsIds).toEqual([]);
  expect(s.companies.get("company-2")!.linkedContactsIds).toEqual([]);
  expect(s.companies.get("company-3")!.linkedContactsIds).toEqual([1]);
});
it("retries a partial Membership move using current state for both pairs", async () => {
  const s = state();
  await s.invoke(MEMBERSHIP_SYNC_TASK);
  await fixture.db
    .insert(organization)
    .values({ id: "p", name: "New", slug: "new", createdAt: new Date() });
  await fixture.db.update(member).set({ organizationId: "p" }).where(eq(member.id, "m"));
  let failed = false;
  s.hooks.after = async (method, path) => {
    if (!failed && method === "GET" && path === "/companies") {
      failed = true;
      throw new Error("transient lookup");
    }
  };
  const payload = {
    ...s.origin,
    kind: "membership",
    userId: "u",
    organizationId: "p",
    previous: { userId: "u", organizationId: "o" },
  };
  await expect(s.invoke(MEMBERSHIP_SYNC_TASK, payload)).rejects.toThrow(
    "CRM synchronization failed",
  );
  expect(s.companies.get("company-1")!.linkedContactsIds).toEqual([]);
  await s.invoke(MEMBERSHIP_SYNC_TASK, payload, 2);
  expect(s.companies.get("company-1")!.linkedContactsIds).toEqual([]);
  expect(s.companies.get("company-2")!.linkedContactsIds).toEqual([1]);
});
