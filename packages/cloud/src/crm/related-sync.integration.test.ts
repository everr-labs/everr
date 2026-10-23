// @vitest-environment node
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { member, organization, user } from "@everr/app/db/schema";
import { createAuthTestDatabase } from "@everr/app/identity/testing/database";
import { eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  makeWorkerUtils,
  run,
  type JobHelpers,
  type Runner,
  type WorkerEvents,
  type WorkerUtils,
} from "graphile-worker";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { crmProjection } from "../db/schema/crm";
import { createBrevoAdapter } from "./brevo/adapter";
import { readBrevoConfig } from "./brevo/config";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  relatedSyncSpec,
  userSyncSpec,
} from "./jobs";
import { enqueueCrmOrphans } from "./orphans";
import { createCrmTaskList } from "./task-list";
import { createCrmSnapshotReader, projectionIdentity } from "./snapshots";
import { createCrmProjectionStore } from "./store";
import { attachCrmRetryPolicy } from "./retries";

vi.mock("@everr/app/db/client", () => ({ db: undefined }));
vi.mock("../app/env", () => ({ appEnv: { POLAR_PRO_PRODUCT_ID: "product_pro" } }));

describe.skipIf(!process.env.EVERR_IDENTITY_TEST_DATABASE_URL)(
  "company and explicit pair synchronization (PostgreSQL/Graphile)",
  () => {
    let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>;
    let store: ReturnType<typeof createCrmProjectionStore>;
    let reader: ReturnType<typeof createCrmSnapshotReader>;
    let utils: WorkerUtils;
    const runners: Runner[] = [];
    const userKey = { kind: "user" as const, sourceId: "u" };
    const orgKey = (id = "a") => ({ kind: "organization" as const, sourceId: id });
    const pairKey = (id = "a", userId = "u") =>
      projectionIdentity("test", { kind: "membership", userId, organizationId: id });
    function payload(kind: "organization" | "membership", organizationId = "a", userId = "u") {
      return {
        version: 1,
        kind,
        organizationId,
        ...(kind === "membership" ? { userId } : {}),
        eventId: "event",
        eventType: "membership.updated",
        occurredAt: new Date().toISOString(),
        failures: 0,
      };
    }
    function remote() {
      type Company = {
        id: string;
        name: string;
        attributes: Record<string, string>;
        linkedContactsIds: number[];
      };
      const companies = new Map<string, Company>();
      const contacts = new Map<
        string,
        {
          id: number;
          email: string;
          attributes: Record<string, unknown>;
          emailBlacklisted: boolean;
          smsBlacklisted: boolean;
        }
      >();
      let nextContactId = 1;
      let nextCompanyId = 1;
      const config = readBrevoConfig({
        CRM_BREVO_MODE: "configured",
        CRM_BREVO_API_KEY: "fixture",
        CRM_BREVO_DEPLOYMENT: "test",
        CRM_BREVO_ACCOUNT_SCOPE: "fixture",
      });
      const hooks = {
        loseCreate: false,
        failDelete: false,
        failAssociation: false,
        generalAllowed: true,
        afterRequest: undefined as undefined | ((method: string, path: string) => Promise<void>),
      };
      const transport = vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname.replace("/v3", "");
        const method = init.method!;
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        let response: Response;
        if (method === "DELETE" && hooks.failDelete) return new Response("{}", { status: 500 });
        if (path === "/companies" && method === "POST") {
          const id = `company-${nextCompanyId++}`;
          companies.set(id, { id, ...body, linkedContactsIds: [] });
          if (hooks.loseCreate) {
            hooks.loseCreate = false;
            throw new Error("Lost accepted response");
          }
          response = Response.json({ id }, { status: 201 });
        } else if (path === "/companies" && method === "GET") {
          response = Response.json({ items: [...companies.values()] });
        } else if (path.startsWith("/companies/link-unlink/")) {
          if (hooks.failAssociation) {
            hooks.failAssociation = false;
            return new Response("{}", { status: 500 });
          }
          const company = companies.get(path.split("/").at(-1)!);
          if (!company) return new Response("{}", { status: 404 });
          company.linkedContactsIds = body.linkContactIds
            ? [...new Set([...company.linkedContactsIds, ...body.linkContactIds])]
            : company.linkedContactsIds.filter((id) => !body.unlinkContactIds.includes(id));
          response = new Response(undefined, { status: 204 });
        } else if (path.startsWith("/companies/")) {
          const company = companies.get(path.split("/").at(-1)!);
          if (!company) response = new Response("{}", { status: 404 });
          else if (method === "GET") response = Response.json(company);
          else if (method === "DELETE") {
            companies.delete(company.id);
            response = new Response(undefined, { status: 204 });
          } else {
            Object.assign(company, {
              ...(body.name ? { name: body.name } : {}),
              attributes: { ...company.attributes, ...body.attributes },
            });
            response = new Response(undefined, { status: 204 });
          }
        } else if (path === "/contacts" && method === "POST") {
          const id = nextContactId++;
          contacts.set(body.ext_id, {
            id,
            email: body.email,
            attributes: { EXT_ID: body.ext_id, ...body.attributes },
            emailBlacklisted: true,
            smsBlacklisted: true,
          });
          response = Response.json({ id }, { status: 201 });
        } else if (path.startsWith("/contacts/") && method === "GET") {
          const contact = contacts.get(decodeURIComponent(path.slice("/contacts/".length)));
          response = contact ? Response.json(contact) : new Response("{}", { status: 404 });
        } else if (path.startsWith("/contacts/") && method === "DELETE") {
          const contact = [...contacts.entries()].find(
            ([, entry]) => entry.id === Number(path.split("/").at(-1)),
          );
          if (!contact) response = new Response("{}", { status: 404 });
          else {
            contacts.delete(contact[0]);
            for (const company of companies.values())
              company.linkedContactsIds = company.linkedContactsIds.filter(
                (id) => id !== contact[1].id,
              );
            response = new Response(undefined, { status: 204 });
          }
        } else if (path.startsWith("/contacts/") && method === "PUT") {
          const contact = [...contacts.values()].find(
            (entry) => entry.id === Number(path.split("/").at(-1)),
          )!;
          if (body.attributes.EMAIL) contact.email = body.attributes.EMAIL;
          Object.assign(contact.attributes, body.attributes);
          response = new Response(undefined, { status: 204 });
        } else throw new Error("Unexpected controlled provider request");
        await hooks.afterRequest?.(method, path);
        return response;
      });
      const adapter = createBrevoAdapter(
        config,
        {
          acquire: async (group) =>
            group === "general" && !hooks.generalAllowed
              ? { allowed: false, retryAt: new Date(Date.now() + 36_000) }
              : { allowed: true },
          cooldown: async () => {},
        },
        transport,
      );
      return { companies, contacts, hooks, transport, adapter };
    }
    function tasks(provider = remote()) {
      const diagnostic = vi.fn();
      const taskList = createCrmTaskList({
        pool: fixture.database.$client,
        deployment: "test",
        reader,
        store,
        adapter: provider.adapter,
        diagnostic,
      });
      const queued: { name: string; body: unknown; spec: unknown }[] = [];
      const addJob = vi.fn(async (name, body, spec) => {
        queued.push({ name, body, spec });
      });
      async function invoke(name: string, body: unknown, override: Partial<JobHelpers> = {}) {
        await taskList[name]!(body, {
          addJob,
          abortSignal: new AbortController().signal,
          job: { id: "manual", task_identifier: name, attempts: 1, max_attempts: 8 },
          ...override,
        } as unknown as JobHelpers);
      }
      return { taskList, queued, addJob, diagnostic, invoke, provider };
    }
    async function ready(state: ReturnType<typeof tasks>, organizationId = "a") {
      await state.invoke(USER_SYNC_TASK, {
        version: 1,
        userId: "u",
        eventId: "event",
        eventType: "identity.user.updated",
        occurredAt: new Date().toISOString(),
        failures: 0,
      });
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization", organizationId));
    }
    async function until(check: () => Promise<boolean>) {
      const deadline = Date.now() + 7000;
      while (!(await check())) {
        if (Date.now() > deadline) throw new Error("CRM integration timeout");
        await delay(20);
      }
    }
    async function start(state: ReturnType<typeof tasks>) {
      const events: WorkerEvents = new EventEmitter();
      attachCrmRetryPolicy(events, fixture.database.$client);
      const runner = await run({
        pgPool: fixture.database.$client,
        concurrency: 1,
        noHandleSignals: true,
        pollInterval: 50,
        taskList: state.taskList,
        events,
      });
      runners.push(runner);
      return runner;
    }
    beforeAll(async () => {
      fixture = await createAuthTestDatabase(process.env.EVERR_IDENTITY_TEST_DATABASE_URL);
      const config = getTableConfig(crmProjection);
      const dialect = new PgDialect();
      const columns = config.columns.map((column) => {
        const value =
          column.default instanceof SQL
            ? dialect.sqlToQuery(column.default).sql
            : column.default === undefined
              ? undefined
              : JSON.stringify(column.default).replaceAll('"', "'");
        return `"${column.name}" ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}${value === undefined ? "" : ` DEFAULT ${value}`}`;
      });
      await fixture.client
        .exec(`CREATE TABLE crm_projection (${columns.join(",")}, PRIMARY KEY (deployment,kind,source_id), UNIQUE(external_id), UNIQUE(deployment,kind,remote_id));
CREATE TABLE organization_billing (org_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE, plan text NOT NULL DEFAULT 'hobby', polar_customer_id text);
CREATE TABLE org_subscription (org_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE, polar_subscription_id text NOT NULL, polar_product_id text NOT NULL, status text NOT NULL, current_period_end timestamp, cancel_at_period_end boolean NOT NULL DEFAULT false, polar_modified_at timestamp NOT NULL, updated_at timestamp NOT NULL DEFAULT now());`);
      store = createCrmProjectionStore(fixture.database, "test");
      reader = createCrmSnapshotReader(fixture.database, "test");
      utils = await makeWorkerUtils({ pgPool: fixture.database.$client });
      await utils.migrate();
    });
    beforeEach(async () => {
      await fixture.client.exec('TRUNCATE "user", organization, crm_projection CASCADE');
      const jobs = await fixture.client.query<{ id: string }>(
        "SELECT id FROM graphile_worker.jobs",
      );
      await utils.completeJobs(jobs.rows.map((row) => row.id));
      await fixture.database.insert(user).values([
        {
          id: "u",
          name: "Owner",
          email: "one@same.example.test",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "v",
          name: "Other owner",
          email: "two@same.example.test",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      await fixture.database.insert(organization).values([
        { id: "a", name: "First", slug: "first", createdAt: new Date() },
        { id: "b", name: "Second", slug: "second", createdAt: new Date() },
      ]);
      await fixture.database.insert(member).values([
        { id: "ma", userId: "u", organizationId: "a", role: "owner", createdAt: new Date() },
        { id: "mb", userId: "u", organizationId: "b", role: "member", createdAt: new Date() },
        { id: "mv", userId: "v", organizationId: "a", role: "owner", createdAt: new Date() },
      ]);
    });
    afterEach(async () => {
      await Promise.all(runners.splice(0).map((runner) => runner.stop()));
    });
    afterAll(async () => {
      await utils?.release();
      await fixture?.client.close();
    });

    it("keeps same-domain Organizations separate, several Owners and multiple explicit links; removal only unlinks one pair", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization", "b"));
      await state.invoke(USER_SYNC_TASK, {
        version: 1,
        userId: "v",
        eventId: "event-v",
        eventType: "identity.user.updated",
        occurredAt: new Date().toISOString(),
        failures: 0,
      });
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership", "b"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership", "a", "v"));
      expect(state.provider.companies.size).toBe(2);
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([1, 2]);
      expect(state.provider.companies.get("company-2")!.linkedContactsIds).toEqual([1]);
      await fixture.database.delete(member).where(eq(member.id, "ma"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([2]);
      expect(state.provider.companies.get("company-2")!.linkedContactsIds).toEqual([1]);
      expect(await store.read(pairKey())).toMatchObject({
        desired: { deleted: true },
        remoteContactId: "1",
        remoteCompanyId: "company-1",
        outcome: "synced",
      });
      // Re-add with a different row ID, then deliver an old remove notification: latest pair wins.
      await fixture.database.insert(member).values({
        id: "replacement",
        userId: "u",
        organizationId: "a",
        role: "member",
        createdAt: new Date(),
      });
      await state.invoke(MEMBERSHIP_SYNC_TASK, {
        ...payload("membership"),
        eventType: "membership.removed",
      });
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([2, 1]);
      expect(state.provider.companies.size).toBe(2);
    });

    it("persists suspended Pro, subscription and provisioning independently and omits unchanged fields", async () => {
      await fixture.client.exec(
        "INSERT INTO organization_billing(org_id,plan) VALUES ('a','pro'); INSERT INTO org_subscription(org_id,polar_subscription_id,polar_product_id,status,cancel_at_period_end,polar_modified_at) VALUES ('a','sub','product_pro','past_due',true,now())",
      );
      const state = tasks();
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(state.provider.companies.get("company-1")!.attributes).toMatchObject({
        everr_plan: "pro",
        everr_app_state: "suspended",
        everr_subscription_status: "past_due",
        everr_cancel_at_period_end: "true",
        everr_provisioning: "ready",
      });
      const before = state.provider.transport.mock.calls.length;
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(state.provider.transport).toHaveBeenCalledTimes(before);
      await fixture.database
        .update(organization)
        .set({ name: "Renamed" })
        .where(eq(organization.id, "a"));
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      const patches = state.provider.transport.mock.calls.filter(
        ([url, init]) => init.method === "PATCH" && !url.includes("link-unlink"),
      );
      expect(patches).toHaveLength(1);
      const body = patches[0][1].body;
      if (typeof body !== "string") throw new Error("Expected JSON body");
      expect(JSON.parse(body)).toEqual({ name: "Renamed" });
    });

    it("recovers a lost successful create, and a crash after intent, without another POST", async () => {
      const state = tasks();
      state.provider.hooks.loseCreate = true;
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        companyCreateAttemptedAt: expect.any(Date),
        retryFailures: 1,
      });
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        remoteId: "company-1",
        outcome: "synced",
      });
      expect(
        state.provider.transport.mock.calls.filter(
          ([url, init]) => url.endsWith("/companies") && init.method === "POST",
        ),
      ).toHaveLength(1);
      const other = await store.desire(await reader.organization("b"));
      await store.companyCreateIntent("b", other.desiredRevision);
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization", "b"));
      expect(state.provider.companies.size).toBe(1);
      expect(await store.read(orgKey("b"))).toMatchObject({
        lastErrorCode: "recovery_not_visible",
        retryFailures: 1,
      });
    });

    it("binds a known accepted ID even if source changes while create is in flight", async () => {
      const state = tasks();
      state.provider.hooks.afterRequest = async (method, path) => {
        if (method === "POST" && path === "/companies") {
          await fixture.database
            .update(organization)
            .set({ name: "New desired" })
            .where(eq(organization.id, "a"));
          state.provider.hooks.afterRequest = undefined;
        }
      };
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        remoteId: "company-1",
        outcome: "pending",
        desiredRevision: 2,
      });
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(state.provider.companies.get("company-1")!.name).toBe("New desired");
      expect(state.provider.companies.size).toBe(1);
    });

    it("resumes PATCH after its persisted GET despite the 36-second general permit", async () => {
      const state = tasks();
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      await fixture.database
        .update(organization)
        .set({ name: "Updated" })
        .where(eq(organization.id, "a"));
      state.provider.hooks.afterRequest = async (method) => {
        if (method === "GET") state.provider.hooks.generalAllowed = false;
      };
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        companyRead: { id: "company-1" },
        retryFailures: 0,
      });
      state.provider.hooks.generalAllowed = true;
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(state.provider.companies.get("company-1")!.name).toBe("Updated");
      expect(
        state.provider.transport.mock.calls.filter(([, init]) => init.method === "GET"),
      ).toHaveLength(1);
    });

    it("rechecks changed source between GET and PATCH, and after a link", async () => {
      const state = tasks();
      await ready(state);
      await fixture.database
        .update(organization)
        .set({ name: "Intermediate" })
        .where(eq(organization.id, "a"));
      state.provider.hooks.afterRequest = async (method) => {
        if (method === "GET") {
          await fixture.database
            .update(organization)
            .set({ name: "Latest" })
            .where(eq(organization.id, "a"));
          state.provider.hooks.afterRequest = undefined;
        }
      };
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(state.provider.companies.get("company-1")!.name).toBe("First");
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(state.provider.companies.get("company-1")!.name).toBe("Latest");
      state.provider.hooks.afterRequest = async (_method, path) => {
        if (path.includes("link-unlink")) {
          await fixture.database.delete(member).where(eq(member.id, "ma"));
          state.provider.hooks.afterRequest = undefined;
        }
      };
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      expect(await store.read(pairKey())).toMatchObject({
        desired: { deleted: true },
        outcome: "pending",
      });
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([]);
    });

    it("retains partial link progress and retries only the failed explicit pair", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization", "b"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      state.provider.hooks.failAssociation = true;
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership", "b"));
      expect(await store.read(pairKey("b"))).toMatchObject({
        remoteContactId: "1",
        remoteCompanyId: "company-2",
        retryFailures: 1,
      });
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership", "b"));
      expect(
        [...state.provider.companies.values()].map((entry) => entry.linkedContactsIds),
      ).toEqual([[1], [1]]);
    });

    it("blocks a mapped parent identity conflict and still permits removal of retained pairs", async () => {
      const state = tasks();
      await ready(state);
      const company = await store.read(orgKey());
      // Create a new desired revision so markFailed is not ignored after prior success.
      await fixture.database
        .update(organization)
        .set({ name: "Changed" })
        .where(eq(organization.id, "a"));
      const changed = await store.desire(await reader.organization("a"));
      await store.markFailed(orgKey(), changed.desiredRevision, "remote_identity_conflict", true);
      await expect(state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"))).rejects.toThrow(
        "requires inspection",
      );
      expect(company?.remoteId).toBe("company-1");
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([]);
      await store.bindRemote(pairKey(), { remoteContactId: "1", remoteCompanyId: "company-1" });
      state.provider.companies.get("company-1")!.linkedContactsIds = [1];
      await fixture.database.delete(member).where(eq(member.id, "ma"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([]);
    });

    it("reassesses a dependency block after parent recovery without resetting the pair allowance", async () => {
      const state = tasks();
      await ready(state);
      await fixture.database
        .update(organization)
        .set({ name: "Invalid parent" })
        .where(eq(organization.id, "a"));
      const parent = await store.desire(await reader.organization("a"));
      await store.markFailed(orgKey(), parent.desiredRevision, "provider_rejected", true);
      const pair = await store.desire(await reader.membership("u", "a"));
      await store.setRetryFailures(pairKey(), pair.desiredRevision, 0, 2);
      await expect(state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"))).rejects.toThrow(
        "requires inspection",
      );
      expect(await store.read(pairKey())).toMatchObject({
        desiredRevision: pair.desiredRevision,
        retryFailures: 2,
        lastErrorCode: "prerequisite_blocked",
      });
      await fixture.database
        .update(organization)
        .set({ name: "Recovered parent" })
        .where(eq(organization.id, "a"));
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      state.provider.hooks.failAssociation = true;
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      expect(await store.read(pairKey())).toMatchObject({
        desiredRevision: pair.desiredRevision,
        retryFailures: 3,
        outcome: "failed",
      });
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([1]);
      expect(await store.read(pairKey())).toMatchObject({
        desiredRevision: pair.desiredRevision,
        outcome: "synced",
        retryFailures: 0,
      });
    });

    it("honors terminal parent tombstones and captures deletion during company HTTP", async () => {
      const state = tasks();
      state.provider.hooks.afterRequest = async (method, path) => {
        if (method === "POST" && path === "/companies")
          await fixture.database.delete(organization).where(eq(organization.id, "a"));
      };
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        remoteId: "company-1",
        desired: { deleted: true },
        outcome: "pending",
      });
      state.provider.hooks.afterRequest = undefined;
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(state.provider.companies.size).toBe(0);
      await fixture.database
        .insert(organization)
        .values({ id: "a", name: "Invalid reused ID", slug: "reused", createdAt: new Date() });
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(state.provider.companies.size).toBe(0);
      expect(await store.read(orgKey())).toMatchObject({
        desired: { deleted: true },
        outcome: "synced",
      });
    });

    const userPayload = (userId = "u") => ({
      version: 1,
      userId,
      eventId: "deletion-event",
      eventType: "identity.user.deleted",
      occurredAt: new Date().toISOString(),
      failures: 0,
    });

    it("pages retained mappings and repairs lost deletion events with real persisted jobs after cascades", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization", "b"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership", "b"));
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      let after: { kind: "user" | "organization" | "membership"; sourceId: string } | undefined;
      let checked = 0;
      let enqueued = 0;
      do {
        const page = await enqueueCrmOrphans({
          store,
          reader,
          enqueue: utils.addJob,
          after,
          limit: 1,
          checkId: "orphan-check",
          detectedAt: new Date().toISOString(),
        });
        checked += page.checked;
        enqueued += page.enqueued;
        after = page.after;
      } while (after);
      expect(checked).toBe(5);
      expect(enqueued).toBe(2);
      await start(state);
      await until(
        async () =>
          (await store.read(orgKey()))?.outcome === "synced" &&
          (await store.read(pairKey()))?.desired.deleted &&
          (await store.read(pairKey()))?.outcome === "synced",
      );
      expect(state.provider.companies.has("company-1")).toBe(false);
      expect(state.provider.companies.get("company-2")!.linkedContactsIds).toEqual([1]);
      expect(state.provider.contacts.size).toBe(1);
      expect(await store.read(orgKey())).toMatchObject({
        remoteId: "company-1",
        deletedAt: expect.any(Date),
      });
      expect(await store.read(pairKey())).toMatchObject({
        remoteContactId: "1",
        remoteCompanyId: "company-1",
      });
    });

    it("cleans a deleted User without touching other contacts and keeps a same-email new identity distinct", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      await state.invoke(USER_SYNC_TASK, {
        ...userPayload("v"),
        eventType: "identity.user.updated",
      });
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership", "a", "v"));
      await fixture.database.delete(user).where(eq(user.id, "u"));
      // A newer identity is never selected by the old user's deletion job.
      await fixture.database
        .insert(user)
        .values({ id: "replacement", name: "New", email: "one@same.example.test" });
      await state.invoke(USER_SYNC_TASK, {
        ...userPayload("replacement"),
        eventType: "identity.user.created",
      });
      await state.invoke(USER_SYNC_TASK, userPayload());
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      const remaining = [...state.provider.contacts.values()];
      expect(remaining.map((entry) => entry.attributes.EXT_ID)).toEqual([
        projectionIdentity("test", { kind: "user", id: "v" }).externalId,
        projectionIdentity("test", { kind: "user", id: "replacement" }).externalId,
      ]);
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([2]);
      expect(await store.read(userKey)).toMatchObject({
        remoteId: "1",
        desired: { deleted: true },
        outcome: "synced",
      });
      const calls = state.provider.transport.mock.calls.length;
      await state.invoke(USER_SYNC_TASK, { ...userPayload(), eventType: "identity.user.created" });
      expect(state.provider.transport).toHaveBeenCalledTimes(calls);
    });

    it("cleans a Contact whose accepted create lost its local binding", async () => {
      const state = tasks();
      const binding = vi
        .spyOn(store, "bindRemote")
        .mockRejectedValueOnce(new Error("binding unavailable"));
      await expect(
        state.invoke(USER_SYNC_TASK, { ...userPayload(), eventType: "identity.user.created" }),
      ).rejects.toThrow("persisted work");
      binding.mockRestore();
      expect((await store.read(userKey))?.remoteId).toBeNull();
      await fixture.database.delete(user).where(eq(user.id, "u"));
      await state.invoke(USER_SYNC_TASK, userPayload());
      expect(state.provider.contacts.size).toBe(0);
      expect(await store.read(userKey)).toMatchObject({ remoteId: "1", outcome: "synced" });
      expect(
        state.provider.transport.mock.calls.filter(([, init]) => init.method === "POST"),
      ).toHaveLength(1);
    });

    it("cleans deletion during User PUT under the same parent lock before stale upserts can recreate it", async () => {
      const state = tasks();
      await ready(state);
      await fixture.database.update(user).set({ name: "Changed" }).where(eq(user.id, "u"));
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.provider.hooks.afterRequest = async (method) => {
        if (method === "PUT") {
          enter();
          await held;
        }
      };
      await start(state);
      await start(state);
      await utils.addJob(
        USER_SYNC_TASK,
        { ...userPayload(), eventType: "identity.user.updated" },
        userSyncSpec("u"),
      );
      await entered;
      await fixture.database.delete(user).where(eq(user.id, "u"));
      await utils.addJob(USER_SYNC_TASK, userPayload(), userSyncSpec("u"));
      await delay(100);
      expect(state.provider.contacts.size).toBe(1);
      state.provider.hooks.afterRequest = undefined;
      release();
      await until(
        async () =>
          (await store.read(userKey))?.desired.deleted &&
          (await store.read(userKey))?.outcome === "synced",
      );
      expect(state.provider.contacts.size).toBe(0);
      await state.invoke(USER_SYNC_TASK, { ...userPayload(), eventType: "identity.user.created" });
      expect(state.provider.contacts.size).toBe(0);
    });

    it("treats remote GET/DELETE 404 as success and preserves the retained cleanup identity", async () => {
      const state = tasks();
      await ready(state);
      await fixture.database.delete(user).where(eq(user.id, "u"));
      state.provider.contacts.clear();
      await state.invoke(USER_SYNC_TASK, userPayload());
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      state.provider.hooks.afterRequest = async (method) => {
        if (method === "GET") state.provider.companies.clear();
      };
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(userKey)).toMatchObject({ outcome: "synced", remoteId: "1" });
      expect(await store.read(orgKey())).toMatchObject({
        outcome: "synced",
        remoteId: "company-1",
      });
    });

    it("refuses mismatched Company, Contact and unlink ownership before destructive HTTP", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      state.provider.companies.get("company-1")!.attributes.everr_org_id = "foreign";
      await fixture.database.delete(member).where(eq(member.id, "ma"));
      await expect(state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"))).rejects.toThrow(
        "requires inspection",
      );
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      await expect(state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"))).rejects.toThrow(
        "requires inspection",
      );
      [...state.provider.contacts.values()][0].id = 99;
      await fixture.database.delete(user).where(eq(user.id, "u"));
      await expect(state.invoke(USER_SYNC_TASK, userPayload())).rejects.toThrow(
        "requires inspection",
      );
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([1]);
      expect(
        state.provider.transport.mock.calls.filter(([, init]) => init.method === "DELETE"),
      ).toHaveLength(0);
    });

    it("recovers and deletes an unbound accepted Company create after source deletion, without another POST", async () => {
      const state = tasks();
      state.provider.hooks.loseCreate = true;
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        remoteId: null,
        companyCreateAttemptedAt: expect.any(Date),
      });
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        remoteId: "company-1",
        outcome: "synced",
        companyCreateAttemptedAt: expect.any(Date),
      });
      expect(state.provider.companies.size).toBe(0);
      expect(
        state.provider.transport.mock.calls.filter(([, init]) => init.method === "POST"),
      ).toHaveLength(1);
    });

    it.each(["invisible", "duplicate", "full"])(
      "fails closed on %s uncertain-create cleanup inventory",
      async (mode) => {
        const state = tasks();
        const desired = await store.desire(await reader.organization("a"));
        await store.companyCreateIntent("a", desired.desiredRevision);
        const externalId = desired.externalId;
        const count = mode === "duplicate" ? 2 : mode === "full" ? 100 : 0;
        for (let i = 0; i < count; i++)
          state.provider.companies.set(`foreign-${i}`, {
            id: `foreign-${i}`,
            name: "retained",
            attributes: { everr_org_id: externalId },
            linkedContactsIds: [],
          });
        await fixture.database.delete(organization).where(eq(organization.id, "a"));
        for (let i = 0; i < (mode === "duplicate" ? 0 : 8); i++)
          await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
        await expect(state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"))).rejects.toThrow(
          mode === "duplicate" ? "requires inspection" : "allowance exhausted",
        );
        expect((await store.read(orgKey()))?.outcome).not.toBe("synced");
        expect(
          state.provider.transport.mock.calls.filter(
            ([, init]) => init.method === "DELETE" || init.method === "POST",
          ),
        ).toHaveLength(0);
        expect(state.provider.companies.size).toBe(count);
      },
    );

    it("persists a fresh cleanup read across quota deferral and never reuses an upsert ownership cache", async () => {
      const state = tasks();
      await ready(state);
      await store.companyRead("a", { id: "company-1", attributes: { everr_org_id: "foreign" } });
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      state.provider.hooks.afterRequest = async (method) => {
        if (method === "GET") state.provider.hooks.generalAllowed = false;
      };
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        retryFailures: 0,
        cleanupCompanyRead: {
          id: "company-1",
          attributes: { everr_org_id: (await reader.organization("a")).externalId },
        },
      });
      const reads = state.provider.transport.mock.calls.filter(
        ([, init]) => init.method === "GET",
      ).length;
      state.provider.hooks.generalAllowed = true;
      state.provider.hooks.afterRequest = undefined;
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(
        state.provider.transport.mock.calls.filter(([, init]) => init.method === "GET"),
      ).toHaveLength(reads);
      expect(await store.read(orgKey())).toMatchObject({
        outcome: "synced",
        cleanupCompanyRead: null,
      });
    });

    it("coordinates Organization deletion with an in-flight association across independent runners", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization", "b"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership", "b"));
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.provider.hooks.afterRequest = async (_method, path) => {
        if (path.includes("link-unlink")) {
          enter();
          await held;
        }
      };
      await start(state);
      await start(state);
      await utils.addJob(MEMBERSHIP_SYNC_TASK, payload("membership"), relatedSyncSpec("a", "u"));
      await entered;
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      await utils.addJob(ORGANIZATION_SYNC_TASK, payload("organization"), relatedSyncSpec("a"));
      await delay(150);
      expect(
        state.provider.transport.mock.calls.filter(([, init]) => init.method === "DELETE"),
      ).toHaveLength(0);
      state.provider.hooks.afterRequest = undefined;
      release();
      await until(
        async () =>
          (await store.read(orgKey()))?.desired.deleted &&
          (await store.read(orgKey()))?.outcome === "synced",
      );
      expect(state.provider.companies.has("company-1")).toBe(false);
      expect(state.provider.companies.get("company-2")!.linkedContactsIds).toEqual([1]);
    });

    it("rechecks a completed tombstone when a Contact create is accepted late, without reopening on duplicate repair", async () => {
      const state = tasks();
      // The accepted create lost its local binding, then is invisible at initial cleanup.
      const binding = vi
        .spyOn(store, "bindRemote")
        .mockRejectedValueOnce(new Error("binding unavailable"));
      await expect(
        state.invoke(USER_SYNC_TASK, { ...userPayload(), eventType: "identity.user.created" }),
      ).rejects.toThrow("persisted work");
      binding.mockRestore();
      const externalId = (await store.read(userKey))!.externalId;
      const lateContact = state.provider.contacts.get(externalId)!;
      state.provider.contacts.delete(externalId);
      await fixture.database.delete(user).where(eq(user.id, "u"));
      await state.invoke(USER_SYNC_TASK, userPayload());
      const firstCleanup = (await store.read(userKey))!;
      expect(firstCleanup).toMatchObject({
        outcome: "synced",
        desired: { deleted: true },
        remoteId: null,
      });
      state.provider.contacts.set(externalId, lateContact);
      const detectedAt = new Date().toISOString();
      const enqueue = vi.fn(async () => undefined);
      await enqueueCrmOrphans({ store, reader, enqueue, checkId: "late-check", detectedAt });
      expect(enqueue).toHaveBeenCalledWith(
        USER_SYNC_TASK,
        expect.objectContaining({
          eventType: "crm.reconciliation.requested",
          occurredAt: detectedAt,
          recheckDeletionRevision: firstCleanup.desiredRevision,
        }),
        userSyncSpec("u"),
      );
      const repair = {
        ...userPayload(),
        eventType: "crm.reconciliation.requested",
        occurredAt: detectedAt,
        recheckDeletionRevision: firstCleanup.desiredRevision,
      };
      await state.invoke(USER_SYNC_TASK, repair);
      expect(state.provider.contacts.size).toBe(0);
      expect(await store.read(userKey)).toMatchObject({
        desiredRevision: firstCleanup.desiredRevision + 1,
        outcome: "synced",
        remoteId: "1",
        deletedAt: firstCleanup.deletedAt,
      });
      const calls = state.provider.transport.mock.calls.length;
      await state.invoke(USER_SYNC_TASK, repair);
      expect(state.provider.transport).toHaveBeenCalledTimes(calls);
      expect((await store.read(userKey))?.desiredRevision).toBe(firstCleanup.desiredRevision + 1);
    });

    it("keeps durable deletion exhaustion after successor persistence failure and native Graphile retry", async () => {
      const state = tasks();
      await ready(state);
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      const tombstone = await store.desire(await reader.organization("a"));
      await store.setRetryFailures(orgKey(), tombstone.desiredRevision, 0, 7);
      state.provider.hooks.failDelete = true;
      const handler = state.taskList[ORGANIZATION_SYNC_TASK]!;
      state.taskList[ORGANIZATION_SYNC_TASK] = (body, helpers) =>
        handler(body, {
          ...helpers,
          addJob: async (...args) => {
            if (args[0] === ORGANIZATION_SYNC_TASK) throw new Error("successor unavailable");
            return helpers.addJob(...args);
          },
        });
      await start(state);
      const job = await utils.addJob(
        ORGANIZATION_SYNC_TASK,
        payload("organization"),
        relatedSyncSpec("a"),
      );
      await until(async () => (await store.read(orgKey()))?.retryFailures === 8);
      await until(async () => {
        const result = await fixture.client.query<{ locked: boolean }>(
          "SELECT locked_at IS NOT NULL AS locked FROM graphile_worker.jobs WHERE id = $1",
          [String(job.id)],
        );
        return result.rows[0] !== undefined && !result.rows[0].locked;
      });
      const deletes = state.provider.transport.mock.calls.filter(
        ([, init]) => init.method === "DELETE",
      ).length;
      await utils.rescheduleJobs([String(job.id)], { runAt: new Date() });
      await until(async () => {
        const result = await fixture.client.query<{ attempts: number; max_attempts: number }>(
          "SELECT attempts, max_attempts FROM graphile_worker.jobs WHERE id = $1",
          [String(job.id)],
        );
        return result.rows[0]?.attempts === result.rows[0]?.max_attempts;
      });
      expect(
        state.provider.transport.mock.calls.filter(([, init]) => init.method === "DELETE"),
      ).toHaveLength(deletes);
      expect(await store.read(orgKey())).toMatchObject({
        retryFailures: 8,
        lastErrorCode: "retry_budget_exhausted",
      });
    });

    it("refunds ordinary quota and paused deferrals, and bounds unknown/crashed reservations", async () => {
      const state = tasks();
      state.provider.hooks.generalAllowed = false;
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        retryFailures: 0,
        companyCreateAttemptedAt: null,
      });
      state.provider.hooks.generalAllowed = true;
      await ready(state);
      await fixture.database.delete(member).where(eq(member.id, "ma"));
      await store.desire(await reader.membership("u", "a"));
      const removed = (await store.read(pairKey()))!;
      expect(await store.setRetryFailures(pairKey(), removed.desiredRevision, 0, 8)).toBe(true);
      await expect(
        state.invoke(MEMBERSHIP_SYNC_TASK, {
          ...payload("membership"),
          failures: 8,
          desiredRevision: removed.desiredRevision,
        }),
      ).rejects.toThrow("allowance exhausted");
      await fixture.database.insert(member).values({
        id: "new",
        userId: "u",
        organizationId: "a",
        role: "owner",
        createdAt: new Date(),
      });
      await state.invoke(MEMBERSHIP_SYNC_TASK, {
        ...payload("membership"),
        failures: 8,
        desiredRevision: removed.desiredRevision,
      });
      expect(await store.read(pairKey())).toMatchObject({ outcome: "synced", retryFailures: 0 });
    });

    it("uses the single worker slot to create prerequisites instead of waiting for itself", async () => {
      const state = tasks();
      await start(state);
      await utils.addJob(MEMBERSHIP_SYNC_TASK, payload("membership"), relatedSyncSpec("a", "u"));
      await until(
        async () =>
          (await store.read(orgKey()))?.outcome === "synced" &&
          (await store.read(userKey))?.outcome === "synced",
      );
      // Prerequisites run in this one slot. Advance the durable dependent timer for the test.
      const waiting = await fixture.client.query<{ id: string }>(
        "SELECT id FROM graphile_worker.jobs WHERE task_identifier = 'crm/sync-membership'",
      );
      await utils.rescheduleJobs(
        waiting.rows.map((row) => row.id),
        { runAt: new Date() },
      );
      await until(async () => (await store.read(pairKey()))?.outcome === "synced");
      expect(await store.read(userKey)).toMatchObject({ remoteId: "1" });
      expect(await store.read(orgKey())).toMatchObject({ remoteId: "company-1" });
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toContain(1);
    });

    it("coordinates association and parent User HTTP across independent runners, without occupying a slot on lock contention", async () => {
      const state = tasks();
      await ready(state);
      await fixture.database.update(user).set({ name: "Changed owner" }).where(eq(user.id, "u"));
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.provider.hooks.afterRequest = async (method) => {
        if (method === "PUT") {
          enter();
          await held;
          state.provider.hooks.afterRequest = undefined;
        }
      };
      await start(state);
      await start(state);
      await utils.addJob(
        USER_SYNC_TASK,
        {
          version: 1,
          userId: "u",
          eventId: "event-user",
          eventType: "identity.user.updated",
          occurredAt: new Date().toISOString(),
          failures: 0,
        },
        userSyncSpec("u"),
      );
      await entered;
      await utils.addJob(MEMBERSHIP_SYNC_TASK, payload("membership"), relatedSyncSpec("a", "u"));
      await delay(150);
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toEqual([]);
      // Another Organization with a different endpoint can progress during the held User HTTP.
      await utils.addJob(
        ORGANIZATION_SYNC_TASK,
        payload("organization", "b"),
        relatedSyncSpec("b"),
      );
      await until(async () => (await store.read(orgKey("b")))?.outcome === "synced");
      release();
      await until(async () => (await store.read(pairKey()))?.outcome === "synced");
      expect(state.provider.companies.get("company-1")!.linkedContactsIds).toContain(1);
    });

    it("does not repeat POST after successor insertion fails near durable exhaustion", async () => {
      const state = tasks();
      state.provider.hooks.loseCreate = true;
      const desired = await store.desire(await reader.organization("a"));
      await store.setRetryFailures(orgKey(), desired.desiredRevision, 0, 7);
      const failed = vi.fn(async (name: string) => {
        if (name === ORGANIZATION_SYNC_TASK) throw new Error("successor unavailable");
      });
      await expect(
        state.invoke(
          ORGANIZATION_SYNC_TASK,
          { ...payload("organization"), failures: 7, desiredRevision: 1 },
          { addJob: failed as unknown as JobHelpers["addJob"] },
        ),
      ).rejects.toThrow("persisted work");
      expect(await store.read(orgKey())).toMatchObject({
        retryFailures: 8,
        companyCreateAttemptedAt: expect.any(Date),
      });
      await expect(state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"))).rejects.toThrow(
        "allowance exhausted",
      );
      expect(state.provider.companies.size).toBe(1);
    });
    it("does not amplify prerequisite jobs while general quota is unavailable", async () => {
      const state = tasks();
      state.provider.hooks.generalAllowed = false;
      await start(state);
      await utils.addJob(MEMBERSHIP_SYNC_TASK, payload("membership"), relatedSyncSpec("a", "u"));
      await until(async () => !!(await store.read(orgKey())));
      await delay(300);
      const pending = await fixture.client.query<{ count: string }>(
        "SELECT count(*) FROM graphile_worker.jobs WHERE attempts < max_attempts",
      );
      expect(Number(pending.rows[0].count)).toBeLessThanOrEqual(6);
      expect(
        state.provider.transport.mock.calls.filter(([url]) => url.includes("/companies")),
      ).toHaveLength(0);
    });

    it("aborts outbound work and releases its connection after losing the endpoint lock session", async () => {
      const state = tasks();
      await ready(state);
      await fixture.database.update(user).set({ name: "Changed" }).where(eq(user.id, "u"));
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.provider.hooks.afterRequest = async (method) => {
        if (method === "PUT") {
          enter();
          await held;
        }
      };
      const execution = state.invoke(USER_SYNC_TASK, {
        version: 1,
        userId: "u",
        eventId: "event",
        eventType: "identity.user.updated",
        occurredAt: new Date().toISOString(),
        failures: 0,
      });
      const stopped = execution.then(
        () => undefined,
        (error: unknown) => error,
      );
      await entered;
      await fixture.client.query(
        "SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND pid <> pg_backend_pid()",
      );
      const error = await stopped;
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error("Expected rejected execution");
      expect(error.message).toContain("coordination failed");
      const write = state.provider.transport.mock.calls.find(([, init]) => init.method === "PUT")!;
      expect(write[1].signal?.aborted).toBe(true);
      expect(state.queued.some((job) => job.name === USER_SYNC_TASK)).toBe(true);
      release();
      // The next invocation can acquire the same endpoint. No leaked session lock remains.
      state.provider.hooks.afterRequest = undefined;
      await state.invoke(USER_SYNC_TASK, {
        version: 1,
        userId: "u",
        eventId: "next",
        eventType: "identity.user.updated",
        occurredAt: new Date().toISOString(),
        failures: 0,
      });
      expect(await store.read(userKey)).toMatchObject({ outcome: "synced" });
    });

    it("preserves pending Company work in paused mode without spending allowance or retaining an unsent intent", async () => {
      const provider = remote();
      provider.adapter = createBrevoAdapter(
        readBrevoConfig({
          CRM_BREVO_MODE: "paused",
          CRM_BREVO_API_KEY: "fixture",
          CRM_BREVO_DEPLOYMENT: "test",
          CRM_BREVO_ACCOUNT_SCOPE: "fixture",
        }),
        {
          acquire: async () => ({ allowed: true }),
          cooldown: async () => {},
        },
        provider.transport,
      );
      const state = tasks(provider);
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        outcome: "pending",
        retryFailures: 0,
        companyCreateAttemptedAt: null,
      });
      expect(provider.transport).not.toHaveBeenCalled();
      expect(state.queued).toHaveLength(1);
    });

    it("retains native Graphile retry after failed Company successor insertion and caps exhausted work after unlock", async () => {
      const state = tasks();
      state.provider.hooks.loseCreate = true;
      const desired = await store.desire(await reader.organization("a"));
      await store.setRetryFailures(orgKey(), desired.desiredRevision, 0, 7);
      const handler = state.taskList[ORGANIZATION_SYNC_TASK];
      if (!handler) throw new Error("Missing Company task");
      state.taskList[ORGANIZATION_SYNC_TASK] = (body, helpers) =>
        handler(body, {
          ...helpers,
          addJob: async (...args) => {
            if (args[0] === ORGANIZATION_SYNC_TASK)
              throw new Error("Fixture successor unavailable");
            return helpers.addJob(...args);
          },
        });
      await start(state);
      const job = await utils.addJob(
        ORGANIZATION_SYNC_TASK,
        { ...payload("organization"), failures: 7, desiredRevision: 1 },
        relatedSyncSpec("a"),
      );
      await until(async () => (await store.read(orgKey()))?.retryFailures === 8);
      await until(async () => {
        const result = await fixture.client.query<{ locked: boolean }>(
          "SELECT locked_at IS NOT NULL AS locked FROM graphile_worker.jobs WHERE id = $1",
          [String(job.id)],
        );
        return result.rows[0] !== undefined && !result.rows[0].locked;
      });
      await utils.rescheduleJobs([String(job.id)], { runAt: new Date() });
      await until(async () => {
        const result = await fixture.client.query<{ attempts: number; max_attempts: number }>(
          "SELECT attempts, max_attempts FROM graphile_worker.jobs WHERE id = $1",
          [String(job.id)],
        );
        return result.rows[0]?.attempts === result.rows[0]?.max_attempts;
      });
      expect(state.provider.companies.size).toBe(1);
      expect(
        state.provider.transport.mock.calls.filter(
          ([url, init]) => url.endsWith("/companies") && init.method === "POST",
        ),
      ).toHaveLength(1);
      expect(await store.read(orgKey())).toMatchObject({
        retryFailures: 8,
        lastErrorCode: "retry_budget_exhausted",
      });
    });

    it("recovers an accepted Company after local mapping persistence fails, without another create", async () => {
      const state = tasks();
      const binding = vi
        .spyOn(store, "bindRemote")
        .mockRejectedValueOnce(new Error("Fixture binding unavailable"));
      await expect(state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"))).rejects.toThrow(
        "persisted work",
      );
      binding.mockRestore();
      expect(await store.read(orgKey())).toMatchObject({
        remoteId: null,
        companyCreateAttemptedAt: expect.any(Date),
        retryFailures: 1,
      });
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"));
      expect(await store.read(orgKey())).toMatchObject({
        remoteId: "company-1",
        outcome: "synced",
      });
      expect(state.provider.companies.size).toBe(1);
    });
  },
);
