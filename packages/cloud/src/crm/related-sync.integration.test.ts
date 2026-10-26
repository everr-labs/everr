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
import { crmProjection, crmBootstrap, crmBrevoBudget, crmReconciliation } from "../db/schema/crm";
import { createReconciliationTask } from "./reconciliation";
import { bootstrapCrm } from "./bootstrap";
import { createBrevoBudget } from "./brevo/budget";
import { createBrevoAdapter } from "./brevo/adapter";
import { readBrevoConfig } from "./brevo/config";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  relatedSyncSpec,
  userSyncSpec,
} from "./commands";
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
      for (const table of [crmBootstrap, crmBrevoBudget, crmReconciliation]) {
        const config = getTableConfig(table);
        const columns = config.columns.map((column) => {
          const value =
            column.default instanceof SQL
              ? new PgDialect().sqlToQuery(column.default).sql
              : JSON.stringify(column.default);
          return `"${column.name}" ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}${value === undefined ? "" : ` DEFAULT ${value}`}`;
        });
        const pk = config.primaryKeys[0].columns.map((column) => `"${column.name}"`).join(",");
        await fixture.client.exec(
          `CREATE TABLE ${config.name} (${columns.join(",")}, PRIMARY KEY (${pk}))`,
        );
      }
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
      await fixture.client.exec(
        'TRUNCATE "user", organization, crm_projection, crm_bootstrap, crm_brevo_budget, crm_reconciliation CASCADE',
      );
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
    });

    it("pages retained mappings and repairs lost deletion events with real persisted jobs after cascades", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(ORGANIZATION_SYNC_TASK, payload("organization", "b"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership", "b"));
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      const progress = await periodic({ maxPages: 100 });
      expect(progress.admissionCompleted).toBe(true);
      expect(progress.pages).toBeGreaterThan(1);
      const admitted = await bootstrapJobs();
      expect(admitted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            task_identifier: ORGANIZATION_SYNC_TASK,
            payload: expect.objectContaining({ organizationId: "a" }),
          }),
          expect.objectContaining({
            task_identifier: MEMBERSHIP_SYNC_TASK,
            payload: expect.objectContaining({ organizationId: "a", userId: "u" }),
          }),
        ]),
      );
      await start(state);
      await until(
        async () =>
          (await store.read(orgKey()))?.outcome === "synced" &&
          (await store.read(pairKey()))?.desired.deleted &&
          (await store.read(pairKey()))?.outcome === "synced",
      );
      expect(state.provider.companies.has("company-1")).toBe(false);
      expect(state.provider.companies.get("company-2")!.linkedContactsIds).toEqual([1]);
      expect(state.provider.contacts.has("everr:v1:test:user:u")).toBe(true);
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
      const progress = await periodic({ maxPages: 100 });
      const repair = (await bootstrapJobs()).find(
        (job) => job.task_identifier === USER_SYNC_TASK && job.payload.userId === "u",
      )!.payload;
      expect(repair).toMatchObject({
        eventType: "crm.reconciliation.requested",
        eventId: progress.scan_id,
        recheckDeletionRevision: firstCleanup.desiredRevision,
      });
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
      await expect(state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"))).rejects.toThrow(
        "allowance exhausted",
      );
      await fixture.database.insert(member).values({
        id: "new",
        userId: "u",
        organizationId: "a",
        role: "owner",
        createdAt: new Date(),
      });
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      expect(await store.read(pairKey())).toMatchObject({ outcome: "synced", retryFailures: 0 });
    });

    it.each(["organization", "membership"] as const)(
      "preserves persisted allowances on quota deferral and exhaustion for %s",
      async (kind) => {
        const state = tasks();
        if (kind === "membership") await ready(state);
        const snapshot =
          kind === "organization"
            ? await reader.organization("a")
            : await reader.membership("u", "a");
        const saved = await store.desire(snapshot);
        const key = kind === "organization" ? orgKey() : pairKey();
        await store.setRetryFailures(key, saved.desiredRevision, 0, 2);
        state.provider.hooks.generalAllowed = false;
        const name = kind === "organization" ? ORGANIZATION_SYNC_TASK : MEMBERSHIP_SYNC_TASK;
        const body = payload(kind);
        await state.invoke(name, body);
        expect((await store.read(key))?.retryFailures).toBe(2);
        const next = [...state.queued].reverse().find((job) => job.name === name)!.body;
        expect(next).toMatchObject({ version: 1 });
        expect(next).not.toHaveProperty("failures");
        expect(next).not.toHaveProperty("desiredRevision");
        expect(state.diagnostic).toHaveBeenLastCalledWith("deferred", body, "manual", 2);
        await store.setRetryFailures(key, saved.desiredRevision, 2, 8);
        const calls = state.provider.transport.mock.calls.length;
        await expect(state.invoke(name, body)).rejects.toThrow("allowance exhausted");
        expect(state.provider.transport).toHaveBeenCalledTimes(calls);
        expect((await store.read(key))?.retryFailures).toBe(8);
      },
    );

    it("preserves the deletion retry budget and reports its refunded allowance", async () => {
      const state = tasks();
      await ready(state);
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      const tombstone = await store.desire(await reader.organization("a"));
      await store.setRetryFailures(orgKey(), tombstone.desiredRevision, 0, 3);
      state.provider.hooks.generalAllowed = false;
      const body = payload("organization");
      await state.invoke(ORGANIZATION_SYNC_TASK, body);
      expect((await store.read(orgKey()))?.retryFailures).toBe(3);
      expect(state.diagnostic).toHaveBeenLastCalledWith("deferred", body, "manual", 3);
      const next = [...state.queued]
        .reverse()
        .find((job) => job.name === ORGANIZATION_SYNC_TASK)!.body;
      expect(next).toMatchObject({ version: 1 });
      expect(next).not.toHaveProperty("failures");
      expect(next).not.toHaveProperty("desiredRevision");
      await store.setRetryFailures(orgKey(), tombstone.desiredRevision, 3, 8);
      const calls = state.provider.transport.mock.calls.length;
      await expect(state.invoke(ORGANIZATION_SYNC_TASK, body)).rejects.toThrow(
        "allowance exhausted",
      );
      expect(state.provider.transport).toHaveBeenCalledTimes(calls);
    });

    it("omits the old deletion count if a guarded recheck commits before its readback fails", async () => {
      const state = tasks();
      const snapshot = {
        ...projectionIdentity("test", { kind: "organization" as const, id: "a" }),
        deleted: true as const,
      };
      const saved = await store.desire(snapshot);
      await store.markSynced(saved, saved.desiredRevision);
      const original = store.recheckDeletion;
      vi.spyOn(store, "recheckDeletion").mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error("private lost deletion readback");
      });
      const body = {
        ...payload("organization"),
        eventType: "crm.reconciliation.requested",
        recheckDeletionRevision: saved.desiredRevision,
      };
      await expect(state.invoke(ORGANIZATION_SYNC_TASK, body)).rejects.toThrow(
        "CRM coordination failed",
      );
      expect(await store.read(orgKey())).toMatchObject({
        desiredRevision: saved.desiredRevision + 1,
        retryFailures: 0,
      });
      expect(state.diagnostic).toHaveBeenLastCalledWith("retry", body, "manual", undefined);
      expect(state.provider.transport).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it.each(["membership.updated", "crm.reconciliation.requested"])(
      "uses the single worker slot for prerequisites while preserving %s origin",
      async (eventType) => {
        const state = tasks();
        await start(state);
        const origin = { ...payload("membership"), eventType };
        await utils.addJob(MEMBERSHIP_SYNC_TASK, origin, relatedSyncSpec("a", "u"));
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
        const user = (await store.read(userKey))!;
        const company = (await store.read(orgKey()))!;
        const checkId = eventType === "crm.reconciliation.requested" ? origin.eventId : null;
        expect(user.remoteCheckId).toBe(checkId);
        expect(company.remoteCheckId).toBe(checkId);
        const repeatedUserCheck = checkId
          ? await store.verifyRemote(userKey, user.desiredRevision, checkId)
          : undefined;
        const repeatedCompanyCheck = checkId
          ? await store.verifyRemote(orgKey(), company.desiredRevision, checkId)
          : undefined;
        expect(repeatedUserCheck).toBeUndefined();
        expect(repeatedCompanyCheck).toBeUndefined();
      },
    );

    it("keeps parent prerequisite lineage without forwarding pair recovery instructions", async () => {
      const state = tasks();
      const origin = {
        ...payload("membership"),
        eventType: "crm.recovery.requested",
        recoverExhaustedRevision: 99,
        verifyRemoteRevision: 99,
        recheckDeletionRevision: 99,
      };
      await state.invoke(MEMBERSHIP_SYNC_TASK, origin);
      const user = state.queued.find((job) => job.name === USER_SYNC_TASK)!;
      const company = state.queued.find((job) => job.name === ORGANIZATION_SYNC_TASK)!;
      const metadata = {
        version: 1,
        eventId: origin.eventId,
        eventType: origin.eventType,
        occurredAt: origin.occurredAt,
      };
      expect(user.body).toEqual({ ...metadata, userId: "u" });
      expect(company.body).toEqual({ ...metadata, kind: "organization", organizationId: "a" });
      const saved = (await store.read(userKey))!;
      await store.setRetryFailures(userKey, saved.desiredRevision, 0, 8);
      await expect(state.invoke(user.name, user.body)).rejects.toThrow("requires inspection");
      expect(await store.read(userKey)).toMatchObject({
        desiredRevision: saved.desiredRevision,
        retryFailures: 8,
      });
      expect(state.provider.transport).not.toHaveBeenCalled();
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
        state.invoke(ORGANIZATION_SYNC_TASK, payload("organization"), {
          addJob: failed as unknown as JobHelpers["addJob"],
        }),
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
    const bootstrapPayloads = new Map<string, Record<string, unknown>>();
    function bootstrap(overrides: Partial<Parameters<typeof bootstrapCrm>[0]> = {}) {
      const { pool = fixture.database.$client, ...rest } = overrides;
      const recordingPool = {
        async connect() {
          const client = await pool.connect();
          const query = client.query.bind(client);
          return new Proxy(client, {
            get(target, key) {
              if (key !== "query") return Reflect.get(target, key);
              return async (text: string, values?: unknown[]) => {
                const result = await query(text, values);
                if (text.includes("graphile_worker.add_job") && result.rows[0]?.id)
                  bootstrapPayloads.set(String(result.rows[0].id), JSON.parse(String(values![1])));
                return result;
              };
            },
          });
        },
      };
      return bootstrapCrm({
        pool: recordingPool,
        mode: "paused",
        deployment: "test",
        accountScope: "account",
        pageSize: 1,
        maxPages: 1,
        ...rest,
      });
    }
    async function bootstrapJobs() {
      return (
        await fixture.client.query<{ id: string; task_identifier: string; run_at: Date }>(
          "SELECT id, task_identifier, run_at FROM graphile_worker.jobs ORDER BY id",
        )
      ).rows.map((job) => ({ ...job, payload: bootstrapPayloads.get(String(job.id))! }));
    }

    it("bootstraps bounded keyset pages, resumes durably and requires explicit completed repeat", async () => {
      const first = await bootstrap();
      expect(first).toMatchObject({
        phase: "user",
        cursor: "u",
        admitted: 1,
        admissionCompleted: false,
        remoteConverged: false,
      });
      expect(await bootstrapJobs()).toHaveLength(1);
      const resumed = await bootstrap({ maxPages: 100 });
      expect(resumed).toMatchObject({
        phase: "completed",
        admitted: 7,
        admissionCompleted: true,
        remoteConverged: false,
      });
      expect(resumed.scan_id).toBe(first.scan_id);
      expect(await bootstrapJobs()).toHaveLength(7);
      expect(await bootstrap({ maxPages: 100 })).toEqual(resumed);
      const repeated = await bootstrap({ maxPages: 100, newScan: true });
      expect(repeated.scan_id).not.toBe(first.scan_id);
      expect(repeated.admitted).toBe(7);
      expect(await bootstrapJobs()).toHaveLength(7);
      expect(
        (await bootstrapJobs()).every((job) => job.payload.eventType === "crm.bootstrap.requested"),
      ).toBe(true);
    });
    it("rolls back an admission failure and its page cursor, then replays safely", async () => {
      await bootstrap();
      const pool = fixture.database.$client;
      const wrapped = {
        async connect() {
          const client = await pool.connect();
          const query = client.query.bind(client);
          return new Proxy(client, {
            get(target, key) {
              if (key !== "query") return Reflect.get(target, key);
              return async (text: string, values?: unknown[]) => {
                if (text.startsWith("UPDATE crm_bootstrap SET scan_id"))
                  throw new Error("Injected checkpoint failure");
                return query(text, values);
              };
            },
          });
        },
      };
      await expect(bootstrap({ pool: wrapped, pageSize: 100 })).rejects.toThrow(
        "checkpoint failure",
      );
      expect(await bootstrapJobs()).toHaveLength(1);
      const progress = await bootstrap();
      expect(progress).toMatchObject({ cursor: "v", admitted: 2 });
      expect(await bootstrapJobs()).toHaveLength(2);
    });
    it("treats a NULL Graphile admission receipt as failure and rolls back the actual page", async () => {
      const pool = fixture.database.$client;
      const wrapped = {
        async connect() {
          const client = await pool.connect();
          const query = client.query.bind(client);
          return new Proxy(client, {
            get(target, key) {
              if (key !== "query") return Reflect.get(target, key);
              return async (text: string, values?: unknown[]) => {
                const result = await query(text, values);
                return text.includes("graphile_worker.add_job")
                  ? { ...result, rows: [{ id: null }] }
                  : result;
              };
            },
          });
        },
      };
      await expect(bootstrap({ pool: wrapped, pageSize: 100 })).rejects.toThrow("admission failed");
      expect(await bootstrapJobs()).toHaveLength(0);
      expect(await bootstrap()).toMatchObject({ cursor: "u", admitted: 1 });
    });
    it("covers inserts behind an earlier cursor on an explicit subsequent scan", async () => {
      await bootstrap();
      await fixture.database.insert(user).values({
        id: "a",
        name: "Concurrent",
        email: "concurrent@example.test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect((await bootstrap({ maxPages: 100 })).admitted).toBe(7);
      expect((await bootstrap({ maxPages: 100, newScan: true })).admitted).toBe(8);
      expect(await bootstrapJobs()).toHaveLength(8);
    });
    it.each(["partial admission", "last admission", "checkpoint"])(
      "cancels after %s without committing the page",
      async (stage) => {
        const controller = new AbortController();
        const pool = fixture.database.$client;
        const wrapped = {
          async connect() {
            const client = await pool.connect();
            const query = client.query.bind(client);
            return new Proxy(client, {
              get(target, key) {
                if (key !== "query") return Reflect.get(target, key);
                return async (text: string, values?: unknown[]) => {
                  const result = await query(text, values);
                  if (
                    stage === "checkpoint"
                      ? text.startsWith("UPDATE crm_bootstrap SET scan_id")
                      : text.includes("graphile_worker.add_job")
                  )
                    controller.abort();
                  return result;
                };
              },
            });
          },
        };
        await expect(
          bootstrap({
            pool: wrapped,
            pageSize: stage === "last admission" ? 1 : 100,
            signal: controller.signal,
          }),
        ).rejects.toThrow();
        expect(await bootstrapJobs()).toHaveLength(0);
        expect(await bootstrap()).toMatchObject({ cursor: "u", admitted: 1 });
      },
    );
    it("rejects overlapping page admission without corrupting the checkpoint", async () => {
      const pool = fixture.database.$client;
      let entered!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const wrapped = {
        async connect() {
          const client = await pool.connect();
          const query = client.query.bind(client);
          return new Proxy(client, {
            get(target, key) {
              if (key !== "query") return Reflect.get(target, key);
              return async (text: string, values?: unknown[]) => {
                const result = await query(text, values);
                if (
                  text.startsWith(
                    "SELECT scan_id, phase, cursor, cursor_kind, admitted, pages, updated_at FROM crm_bootstrap",
                  )
                ) {
                  entered();
                  await gate;
                }
                return result;
              };
            },
          });
        },
      };
      const first = bootstrap({ pool: wrapped });
      await ready;
      await expect(bootstrap()).rejects.toThrow("already admitting");
      release();
      expect(await first).toMatchObject({ cursor: "u", admitted: 1 });
      expect(await bootstrap()).toMatchObject({ cursor: "v", admitted: 2 });
    });
    it("refuses disabled and unsafe restarts, bounds memory, and separates account progress", async () => {
      await expect(bootstrap({ mode: "disabled" })).rejects.toThrow("disabled");
      await expect(bootstrap({ pageSize: 101 })).rejects.toThrow("pageSize");
      await expect(bootstrap({ maxPages: 0 })).rejects.toThrow("pageSize");
      await bootstrap();
      await expect(bootstrap({ newScan: true })).rejects.toThrow("Complete the current");
      expect(await bootstrap({ accountScope: "another" })).toMatchObject({
        cursor: "u",
        admitted: 1,
      });
      expect(await bootstrap()).toMatchObject({ cursor: "v", admitted: 2 });
    });
    it("uses latest state after live updates, deletion and pair replacement; repeats without duplicates", async () => {
      const state = tasks();
      await ready(state);
      await bootstrap({ maxPages: 100 });
      await fixture.database.update(user).set({ name: "Latest name" }).where(eq(user.id, "u"));
      await fixture.database.delete(user).where(eq(user.id, "v"));
      await fixture.database.delete(member).where(eq(member.id, "ma"));
      await fixture.database.insert(member).values({
        id: "replacement",
        userId: "u",
        organizationId: "a",
        role: "admin",
        createdAt: new Date(),
      });
      for (const job of await bootstrapJobs()) await state.invoke(job.task_identifier, job.payload);
      for (const job of state.queued.splice(0)) await state.invoke(job.name, job.body);
      expect(await store.read(userKey)).toMatchObject({
        outcome: "synced",
        desired: { fields: { name: "Latest name" } },
      });
      expect(await store.read({ kind: "user", sourceId: "v" })).toMatchObject({
        outcome: "synced",
        desired: { deleted: true },
      });
      expect(await store.read(pairKey())).toMatchObject({
        outcome: "synced",
        desired: { deleted: false },
      });
      expect(state.provider.contacts.size).toBe(1);
      expect(state.provider.companies.size).toBe(2);
      const before = state.provider.transport.mock.calls.length;
      await bootstrap({ maxPages: 100, newScan: true });
      for (const job of await bootstrapJobs()) await state.invoke(job.task_identifier, job.payload);
      expect(state.provider.contacts.size).toBe(1);
      expect(state.provider.companies.size).toBe(2);
      // Completed deletions may receive an explicit ownership recheck, all live upserts skip HTTP.
      expect(
        state.provider.transport.mock.calls
          .slice(before)
          .every(([, init]) => init.method !== "POST"),
      ).toBe(true);
    });
    it("retains real Graphile quota deferrals and shares bootstrap/live account permits", async () => {
      const budget = createBrevoBudget(fixture.database, "account");
      const replica = createBrevoBudget(fixture.database, "account");
      expect((await budget.acquire("general")).allowed).toBe(true);
      expect((await replica.acquire("general")).allowed).toBe(false);
      const state = tasks();
      state.provider.hooks.generalAllowed = false;
      await bootstrap({ maxPages: 100 });
      await start(state);
      await until(
        async () =>
          (await store.read(orgKey()))?.retryFailures === 0 &&
          (await bootstrapJobs()).some(
            (job) =>
              job.task_identifier === ORGANIZATION_SYNC_TASK && job.run_at.getTime() > Date.now(),
          ),
      );
      expect(await store.read(orgKey())).toMatchObject({
        retryFailures: 0,
        remoteId: null,
        outcome: "pending",
        companyCreateAttemptedAt: null,
      });
      expect(state.provider.companies.size).toBe(0);
      expect((await bootstrap()).admissionCompleted).toBe(true);
    });
    it("does not replenish blocked or exhausted work or ambiguous Company create intent", async () => {
      const saved = await store.desire(await reader.organization("a"));
      await store.setRetryFailures(orgKey(), saved.desiredRevision, 0, 8);
      await store.companyCreateIntent("a", saved.desiredRevision);
      await store.markFailed(orgKey(), saved.desiredRevision, "identity_conflict", true);
      await bootstrap({ maxPages: 100 });
      const state = tasks();
      const job = (await bootstrapJobs()).find(
        (job) => job.payload.organizationId === "a" && job.payload.kind === "organization",
      )!;
      await expect(state.invoke(job.task_identifier, job.payload)).rejects.toThrow(
        "requires inspection",
      );
      expect(await store.read(orgKey())).toMatchObject({
        retryFailures: 8,
        outcome: "blocked",
        companyCreateAttemptedAt: expect.any(Date),
      });
      expect(state.provider.transport).not.toHaveBeenCalled();
    });

    function periodic(overrides: Partial<Parameters<typeof bootstrapCrm>[0]> = {}) {
      return bootstrap({ mode: "configured", periodic: true, ...overrides });
    }
    async function runAdmissions(state: ReturnType<typeof tasks>) {
      for (const job of await bootstrapJobs()) await state.invoke(job.task_identifier, job.payload);
      const jobs = await fixture.client.query<{ id: string }>(
        "SELECT id FROM graphile_worker.jobs",
      );
      await utils.completeJobs(jobs.rows.map((row) => row.id));
      for (const job of state.queued.splice(0)) await state.invoke(job.name, job.body);
    }
    it("repairs dropped initial User, Organization, Membership and current Plan publication", async () => {
      const state = tasks();
      await fixture.client.exec(
        "INSERT INTO organization_billing(org_id, plan) VALUES ('a', 'pro'); INSERT INTO org_subscription(org_id, polar_subscription_id, polar_product_id, status, polar_modified_at) VALUES ('a', 'sub', 'product_pro', 'active', now())",
      );
      // No domain publication or handler ran. Only current authoritative rows exist.
      await periodic({ maxPages: 100 });
      await runAdmissions(state);
      expect(await store.read(userKey)).toMatchObject({ outcome: "synced" });
      expect(await store.read(orgKey())).toMatchObject({
        outcome: "synced",
        desired: { fields: { plan: "pro" } },
      });
      expect(await store.read(pairKey())).toMatchObject({
        outcome: "synced",
        desired: { deleted: false },
      });
    });
    it("freshly verifies owned remote fields and explicit pair drift, with no writes for unchanged state", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      state.queued.splice(0);
      const contact = [...state.provider.contacts.values()][0];
      const company = [...state.provider.companies.values()][0];
      contact.attributes.EVERR_NAME = "Remote drift";
      company.name = "Remote drift";
      company.linkedContactsIds = [];
      await periodic({ maxPages: 100 });
      await runAdmissions(state);
      expect(contact.attributes.EVERR_NAME).toBe("Owner");
      expect(company.name).toBe("First");
      expect(company.linkedContactsIds).toContain(contact.id);
      state.queued.splice(0);
      await fixture.client.exec(
        "UPDATE crm_reconciliation SET updated_at = now() - interval '2 days'",
      );
      const before = state.provider.transport.mock.calls.length;
      await periodic({ maxPages: 100 });
      await runAdmissions(state);
      expect(
        state.provider.transport.mock.calls
          .slice(before)
          .every(([, init]) => init.method === "GET"),
      ).toBe(true);
    });
    it.each(["user", "organization"])(
      "detects mapped missing %s conservatively without recreating it",
      async (kind) => {
        const state = tasks();
        await ready(state);
        state.queued.splice(0);
        if (kind === "user") state.provider.contacts.clear();
        else state.provider.companies.clear();
        const key = kind === "user" ? userKey : orgKey();
        const prior = (await store.read(key))!;
        const body =
          kind === "user"
            ? {
                version: 1,
                userId: "u",
                eventId: "check",
                occurredAt: new Date().toISOString(),
                eventType: "crm.reconciliation.requested",
                verifyRemoteRevision: prior.desiredRevision,
              }
            : {
                ...payload("organization"),
                eventType: "crm.reconciliation.requested",
                verifyRemoteRevision: prior.desiredRevision,
              };
        const before = state.provider.transport.mock.calls.length;
        await expect(
          state.invoke(kind === "user" ? USER_SYNC_TASK : ORGANIZATION_SYNC_TASK, body),
        ).rejects.toThrow();
        expect(await store.read(key)).toMatchObject({
          outcome: "blocked",
          remoteId: prior.remoteId,
          lastErrorCode: kind === "user" ? "mapped_contact_missing" : "mapped_company_missing",
        });
        expect(
          state.provider.transport.mock.calls
            .slice(before)
            .every(([, init]) => init.method === "GET"),
        ).toBe(true);
      },
    );
    it("preserves exhausted allowances and ambiguous intent across duplicate checks; explicit expected revision recovers once", async () => {
      const state = tasks();
      const saved = await store.desire(await reader.organization("a"));
      await store.companyCreateIntent("a", saved.desiredRevision);
      await store.setRetryFailures(orgKey(), saved.desiredRevision, 0, 8);
      await periodic({ maxPages: 100 });
      const body = {
        ...payload("organization"),
        eventType: "crm.reconciliation.requested",
        verifyRemoteRevision: saved.desiredRevision,
      };
      for (let n = 0; n < 2; n++)
        await expect(state.invoke(ORGANIZATION_SYNC_TASK, body)).rejects.toThrow();
      expect(await store.read(orgKey())).toMatchObject({
        desiredRevision: 1,
        retryFailures: 8,
        companyCreateAttemptedAt: expect.any(Date),
      });
      expect(state.provider.transport).not.toHaveBeenCalled();
      await state.invoke(ORGANIZATION_SYNC_TASK, {
        ...body,
        eventType: "crm.recovery.requested",
        recoverExhaustedRevision: 1,
      });
      const recovered = (await store.read(orgKey()))!;
      expect(recovered.desiredRevision).toBe(2);
      expect(recovered.companyCreateAttemptedAt).toEqual(
        (await store.read(orgKey()))!.companyCreateAttemptedAt,
      );
      expect(state.provider.transport.mock.calls.every(([, init]) => init.method === "GET")).toBe(
        true,
      );
      await state.invoke(ORGANIZATION_SYNC_TASK, {
        ...body,
        eventType: "crm.recovery.requested",
        recoverExhaustedRevision: 1,
      });
      expect((await store.read(orgKey()))!.desiredRevision).toBe(2);
    });
    it("resumes periodic pages and repeats a completed cycle to cover inserts behind a cursor", async () => {
      const first = await periodic();
      expect(first).toMatchObject({ cursor: "u", admitted: 1 });
      await fixture.database.insert(user).values({
        id: "a",
        name: "Behind",
        email: "behind@example.test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(await periodic()).toMatchObject({ cursor: "v", admitted: 2 });
      const finished = await periodic({ maxPages: 100 });
      expect(finished.admissionCompleted).toBe(true);
      expect((await periodic()).scan_id).toBe(first.scan_id);
      await fixture.client.exec(
        "UPDATE crm_reconciliation SET updated_at = now() - interval '2 days'",
      );
      expect((await periodic()).scan_id).not.toBe(first.scan_id);
      expect((await bootstrapJobs()).some((job) => job.payload.userId === "a")).toBe(true);
    });
    it("paused/disabled periodic work never completes or admits, and backpressure ignores retained terminal jobs", async () => {
      await expect(periodic({ mode: "paused" })).rejects.toThrow("paused");
      await expect(periodic({ mode: "disabled" })).rejects.toThrow("disabled");
      expect((await fixture.client.query("SELECT * FROM crm_reconciliation")).rows).toHaveLength(0);
      const ids = [];
      for (let i = 0; i < 100; i++)
        ids.push(String((await utils.addJob(USER_SYNC_TASK, {}, { jobKey: `cap-${i}` })).id));
      await expect(periodic()).rejects.toThrow("backlog");
      expect((await fixture.client.query("SELECT * FROM crm_reconciliation")).rows).toHaveLength(0);
      await utils.permanentlyFailJobs(ids, "fixture retained");
      expect(await periodic()).toMatchObject({ admitted: 1 });
    });
    it("does not downgrade queued live jobs or replace their pending retry metadata", async () => {
      await utils.addJob(USER_SYNC_TASK, { live: true }, { ...userSyncSpec("u"), priority: -10 });
      const before = (
        await fixture.client.query(
          "SELECT * FROM graphile_worker.jobs WHERE key = 'crm-user-projection:u'",
        )
      ).rows[0];
      await periodic();
      const after = (
        await fixture.client.query(
          "SELECT * FROM graphile_worker.jobs WHERE key = 'crm-user-projection:u'",
        )
      ).rows[0];
      expect(after).toEqual(before);
    });
    it("reassesses retained terminal work after a lost source change without refreshing unchanged exhaustion", async () => {
      const state = tasks();
      const saved = await store.desire(await reader.user("u"));
      await store.setRetryFailures(userKey, saved.desiredRevision, 0, 8);
      await store.markFailed(userKey, saved.desiredRevision, "retry_budget_exhausted");
      const retained = await utils.addJob(USER_SYNC_TASK, { retained: true }, userSyncSpec("u"));
      await utils.permanentlyFailJobs([String(retained.id)], "fixture exhausted");

      await periodic();
      const first = (await bootstrapJobs()).reverse().find((job) => job.payload?.userId === "u")!;
      expect(first).toBeDefined();
      await start(state);
      await until(
        async () =>
          (
            await fixture.client.query<{ retained: boolean }>(
              "SELECT attempts >= max_attempts AS retained FROM graphile_worker.jobs WHERE id = $1",
              [first.id],
            )
          ).rows[0]?.retained ?? false,
      );
      expect(await store.read(userKey)).toMatchObject({
        desiredRevision: saved.desiredRevision,
        retryFailures: 8,
      });
      expect(state.provider.transport).not.toHaveBeenCalled();

      // No new publication accompanies this authoritative source change.
      await fixture.database
        .update(user)
        .set({ name: "Recovered current name" })
        .where(eq(user.id, "u"));
      await periodic({ maxPages: 100 });
      await until(async () => (await store.read(userKey))?.outcome === "synced");
      expect(await store.read(userKey)).toMatchObject({
        desiredRevision: saved.desiredRevision + 1,
        retryFailures: 0,
        outcome: "synced",
        desired: { fields: { name: "Recovered current name" } },
      });
      expect(state.provider.contacts.get(saved.externalId)?.attributes.EVERR_NAME).toBe(
        "Recovered current name",
      );
    });
    it("tracks the oldest known pending start across retries and exposes periodic progress/failure execution", async () => {
      const saved = await store.desire(await reader.user("u"));
      await fixture.client.exec(
        "UPDATE crm_projection SET pending_since = now() - interval '2 hours'",
      );
      await store.setRetryFailures(userKey, saved.desiredRevision, 0, 1);
      await store.markFailed(userKey, saved.desiredRevision, "provider_unavailable");
      expect((await store.read(userKey))!.pendingSince!.getTime()).toBeLessThan(
        Date.now() - 3600_000,
      );
      const task = createReconciliationTask({
        pool: fixture.database.$client,
        mode: "configured",
        deployment: "test",
        accountScope: "account",
      });
      await task({}, { abortSignal: new AbortController().signal } as JobHelpers);
      expect(
        (await fixture.client.query("SELECT pages FROM crm_reconciliation")).rows[0].pages,
      ).toBe(1);
      await store.markSynced(userKey, saved.desiredRevision);
      expect((await store.read(userKey))!.pendingSince).toBeNull();
    });

    it("repairs lost deletion and removed pair notifications from retained identities", async () => {
      const state = tasks();
      await ready(state);
      await state.invoke(MEMBERSHIP_SYNC_TASK, payload("membership"));
      state.queued.splice(0);
      await fixture.database.delete(member).where(eq(member.id, "ma"));
      await periodic({ maxPages: 100 });
      await runAdmissions(state);
      expect([...state.provider.companies.values()][0].linkedContactsIds).not.toContain(1);
      await fixture.database.delete(user).where(eq(user.id, "u"));
      await fixture.database.delete(organization).where(eq(organization.id, "a"));
      await fixture.client.exec(
        "UPDATE crm_reconciliation SET updated_at = now() - interval '2 days'",
      );
      await periodic({ maxPages: 100 });
      await runAdmissions(state);
      expect(await store.read(userKey)).toMatchObject({
        outcome: "synced",
        desired: { deleted: true },
      });
      expect(await store.read(orgKey())).toMatchObject({
        outcome: "synced",
        desired: { deleted: true },
      });
    });
    it("duplicate completed checks cannot replenish pending verification allowance under quota deferral", async () => {
      const state = tasks();
      await ready(state);
      state.queued.splice(0);
      const saved = (await store.read(orgKey()))!;
      const body = {
        ...payload("organization"),
        eventType: "crm.reconciliation.requested",
        verifyRemoteRevision: saved.desiredRevision,
      };
      state.provider.hooks.generalAllowed = false;
      await state.invoke(ORGANIZATION_SYNC_TASK, body);
      const checking = (await store.read(orgKey()))!;
      await store.setRetryFailures(orgKey(), checking.desiredRevision, 0, 7);
      await state.invoke(ORGANIZATION_SYNC_TASK, body);
      expect(await store.read(orgKey())).toMatchObject({
        desiredRevision: checking.desiredRevision,
        retryFailures: 7,
      });
      expect(
        state.provider.transport.mock.calls.filter(([, init]) => init.method === "POST"),
      ).toHaveLength(2);
    });
    it("rechecks latest source when a live mutation commits during fresh verification", async () => {
      const state = tasks();
      await ready(state);
      state.queued.splice(0);
      const saved = (await store.read(userKey))!;
      state.provider.hooks.afterRequest = async (method, path) => {
        if (method === "GET" && path.startsWith("/contacts/")) {
          state.provider.hooks.afterRequest = undefined;
          await fixture.database.update(user).set({ name: "Live latest" }).where(eq(user.id, "u"));
        }
      };
      await state.invoke(USER_SYNC_TASK, {
        version: 1,
        userId: "u",
        eventId: "verify",
        eventType: "crm.reconciliation.requested",
        occurredAt: new Date().toISOString(),
        verifyRemoteRevision: saved.desiredRevision,
      });
      expect(await store.read(userKey)).toMatchObject({
        outcome: "pending",
        desired: { fields: { name: "Live latest" } },
      });
      for (const job of state.queued.splice(0)) await state.invoke(job.name, job.body);
      expect([...state.provider.contacts.values()][0].attributes.EVERR_NAME).toBe("Live latest");
    });

    it("does not repeat a source-phase verification in the retained phase of the same cycle", async () => {
      const state = tasks();
      await ready(state);
      state.queued.splice(0);
      const initial = (await store.read(userKey))!;
      const first = await periodic({ pageSize: 1 });
      await runAdmissions(state);
      const verified = (await store.read(userKey))!;
      expect(verified.desiredRevision).toBe(initial.desiredRevision + 1);
      expect(verified.remoteCheckId).toBe(first.scan_id);
      await periodic({ maxPages: 100 });
      const sameUser = (await bootstrapJobs()).filter(
        (job) => job.payload.userId === "u" && job.task_identifier === USER_SYNC_TASK,
      );
      expect(sameUser).toHaveLength(0);
      expect((await store.read(userKey))!.desiredRevision).toBe(verified.desiredRevision);
    });

    it("a stale operator recovery still processes newer live pending work without resetting its budget", async () => {
      const state = tasks();
      await ready(state);
      state.queued.splice(0);
      await fixture.database.update(user).set({ name: "New live" }).where(eq(user.id, "u"));
      const newer = await store.desire(await reader.user("u"));
      await store.setRetryFailures(userKey, newer.desiredRevision, 0, 7);
      await state.invoke(USER_SYNC_TASK, {
        version: 1,
        userId: "u",
        eventId: "old-recovery",
        eventType: "crm.recovery.requested",
        occurredAt: new Date().toISOString(),
        recoverExhaustedRevision: 1,
      });
      expect(await store.read(userKey)).toMatchObject({
        desiredRevision: newer.desiredRevision,
        outcome: "synced",
        desired: { fields: { name: "New live" } },
      });
      expect([...state.provider.contacts.values()][0].attributes.EVERR_NAME).toBe("New live");
    });
    it("retains a failed scanner page and emits a bounded failure diagnostic", async () => {
      const pool = fixture.database.$client;
      const broken = Object.create(pool);
      broken.query = async () => {
        throw new Error("Fixture query unavailable");
      };
      broken.connect = async () => {
        throw new Error("Fixture contains private SQL values");
      };
      const task = createReconciliationTask({
        pool: broken,
        mode: "configured",
        deployment: "test",
        accountScope: "account",
      });
      await expect(
        task({}, { abortSignal: new AbortController().signal } as JobHelpers),
      ).rejects.toThrow("CRM reconciliation failed; committed progress remains resumable.");
      expect((await fixture.client.query("SELECT * FROM crm_reconciliation")).rows).toHaveLength(0);
    });

    it("serializes concurrent periodic page admissions and rolls back an interrupted page", async () => {
      const attempts = await Promise.allSettled([periodic(), periodic()]);
      const completed = attempts.filter((result) => result.status === "fulfilled");
      const checkpoint = (
        await fixture.client.query<{ admitted: number }>("SELECT admitted FROM crm_reconciliation")
      ).rows[0];
      expect(checkpoint.admitted).toBe(completed.length);
      const before = checkpoint.admitted;
      const controller = new AbortController();
      const pool = fixture.database.$client;
      const wrapped = {
        async connect() {
          const client = await pool.connect();
          const query = client.query.bind(client);
          return new Proxy(client, {
            get(target, key) {
              if (key !== "query") return Reflect.get(target, key);
              return async (text: string, values?: unknown[]) => {
                const result = await query(text, values);
                if (text.startsWith("UPDATE crm_reconciliation SET scan_id")) controller.abort();
                return result;
              };
            },
          });
        },
      };
      await expect(periodic({ pool: wrapped, signal: controller.signal })).rejects.toThrow();
      expect(
        (await fixture.client.query("SELECT admitted FROM crm_reconciliation")).rows[0].admitted,
      ).toBe(before);
      await expect(periodic()).resolves.toBeDefined();
    });

    it("includes durable sync jobs that have no projection in oldest known pending age", async () => {
      await utils.addJob(USER_SYNC_TASK, {}, userSyncSpec("v"));
      await delay(20);
      const diagnostic = vi.fn();
      const task = createReconciliationTask({
        pool: fixture.database.$client,
        mode: "configured",
        deployment: "test",
        accountScope: "account",
        diagnostic,
      });
      await task({}, { abortSignal: new AbortController().signal } as JobHelpers);
      expect(diagnostic).toHaveBeenCalledWith(
        "progress",
        expect.objectContaining({ oldestKnownPendingSeconds: expect.any(Number) }),
      );
      expect(diagnostic.mock.calls[0][1].oldestKnownPendingSeconds).toBeGreaterThan(0);
      expect(await store.read({ kind: "user", sourceId: "v" })).toBeUndefined();
    });
  },
);
