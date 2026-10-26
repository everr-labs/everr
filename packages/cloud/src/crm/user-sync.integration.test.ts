// @vitest-environment node
import { setTimeout as delay } from "node:timers/promises";
import { EventEmitter } from "node:events";
import { user } from "@everr/app/db/schema";
import {
  createAuthTestDatabase,
  createIdentityTestAuth,
} from "@everr/app/identity/testing/database";
import { userCreated } from "@everr/app/identity/events";
import { createEventPublisher } from "@everr/app/server/events/publisher";
import { addWorkerJobUsing } from "@everr/app/server/worker/jobs";
import { eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  makeWorkerUtils,
  run,
  type JobHelpers,
  type Task,
  type WorkerUtils,
  type Runner,
  type WorkerEvents,
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
import { createCrmSnapshotReader } from "./snapshots";
import { createCrmProjectionStore } from "./store";
import { USER_SYNC_TASK, userSyncSpec, userSyncPayload, type UserSyncPayload } from "./commands";
import { crmEventRoutes } from "./jobs";
import { createUserSyncTask } from "./user-sync";
import { createDeletionCleanup } from "./deletion";
import { coordinateCrmTask } from "./coordination";
import type { createBrevoAdapter } from "./brevo/adapter";
import { attachCrmRetryPolicy } from "./retries";

vi.mock("@everr/app/db/client", () => ({ db: undefined }));
vi.mock("../app/env", () => ({ appEnv: { POLAR_PRO_PRODUCT_ID: "product_pro" } }));

// These are real PostgreSQL/Graphile checks. The URL must point at a disposable empty DB.
describe.skipIf(!process.env.EVERR_IDENTITY_TEST_DATABASE_URL)(
  "persisted CRM user synchronization",
  () => {
    let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>;
    let utils: WorkerUtils;
    let store: ReturnType<typeof createCrmProjectionStore>;
    const runners: Runner[] = [];
    const payload = (): UserSyncPayload => ({
      version: 1,
      userId: "u",
      eventId: "event-u",
      eventType: "identity.user.updated",
      occurredAt: new Date().toISOString(),
    });
    async function seedFailures(count: number) {
      const saved = await store.desire(
        await createCrmSnapshotReader(fixture.database, "test").user("u"),
      );
      expect(
        await store.setRetryFailures(key, saved.desiredRevision, saved.retryFailures, count),
      ).toBe(true);
      return saved;
    }
    const contact = () => ({
      id: 42,
      email: "person@example.test",
      attributes: { EXT_ID: "everr:v1:test:user:u" },
      emailBlacklisted: true,
      smsBlacklisted: true,
    });
    const adapter = () => ({
      getContact: vi.fn<ReturnType<typeof createBrevoAdapter>["getContact"]>(async () => ({
        ok: true as const,
        value: contact(),
      })),
      updateContact: vi.fn<ReturnType<typeof createBrevoAdapter>["updateContact"]>(async () => ({
        ok: true as const,
        value: undefined,
      })),
      createContact: vi.fn<ReturnType<typeof createBrevoAdapter>["createContact"]>(async () => ({
        ok: true as const,
        value: { id: 42 },
      })),
    });
    function task(remote = adapter(), diagnostic = vi.fn()) {
      return coordinateCrmTask({
        pool: fixture.database.$client,
        deployment: "test",
        schema: userSyncPayload,
        endpoints: (command) => [JSON.stringify(["user", command.userId])],
        spec: (command) => userSyncSpec(command.userId),
        invalidMessage: "Invalid CRM user task payload.",
        diagnostic,
        task: createUserSyncTask({
          reader: createCrmSnapshotReader(fixture.database, "test"),
          store,
          adapter: remote,
          diagnostic,
          cleanup: createDeletionCleanup({
            store,
            adapter: {
              ...remote,
              deleteContact: vi.fn(async () => ({ ok: true as const, value: undefined })),
              getCompany: async () => {
                throw new Error("Unexpected Company lookup");
              },
              recoverCompany: async () => {
                throw new Error("Unexpected Company recovery");
              },
              deleteCompany: async () => {
                throw new Error("Unexpected Company deletion");
              },
            },
            diagnostic,
          }),
        }),
      });
    }
    function helpers() {
      const addJob = vi.fn<JobHelpers["addJob"]>();
      return {
        addJob,
        job: { id: "manual-test", task_identifier: USER_SYNC_TASK, attempts: 1, max_attempts: 8 },
      } as unknown as JobHelpers & {
        addJob: typeof addJob;
      };
    }
    const key = { kind: "user" as const, sourceId: "u" };
    async function start(handler: Task) {
      const events: WorkerEvents = new EventEmitter();
      attachCrmRetryPolicy(events, fixture.database.$client);
      const runner = await run({
        pgPool: fixture.database.$client,
        concurrency: 1,
        noHandleSignals: true,
        pollInterval: 50,
        taskList: { [USER_SYNC_TASK]: handler },
        events,
      });
      runners.push(runner);
      return runner;
    }
    async function until(check: () => Promise<boolean>) {
      const deadline = Date.now() + 5000;
      while (!(await check())) {
        if (Date.now() > deadline) throw new Error("CRM test timed out.");
        await delay(20);
      }
    }
    beforeAll(async () => {
      fixture = await createAuthTestDatabase(process.env.EVERR_IDENTITY_TEST_DATABASE_URL);
      const config = getTableConfig(crmProjection);
      const dialect = new PgDialect();
      const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
      const columns = config.columns.map((column) => {
        const value =
          column.default instanceof SQL
            ? dialect.sqlToQuery(column.default).sql
            : column.default === undefined
              ? undefined
              : JSON.stringify(column.default).replaceAll('"', "'");
        return `${quote(column.name)} ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}${value === undefined ? "" : ` DEFAULT ${value}`}`;
      });
      await fixture.client.exec(
        `CREATE TABLE crm_projection (${columns.join(",")}, PRIMARY KEY (deployment,kind,source_id), UNIQUE(external_id), UNIQUE(deployment,kind,remote_id))`,
      );
      store = createCrmProjectionStore(fixture.database, "test");
      utils = await makeWorkerUtils({ pgPool: fixture.database.$client });
      await utils.migrate();
    });
    beforeEach(async () => {
      await fixture.client.exec('TRUNCATE "user", crm_projection CASCADE');
      const jobs = await fixture.client.query<{ id: string }>(
        "SELECT id FROM graphile_worker.jobs",
      );
      await utils.completeJobs(jobs.rows.map((row) => row.id));
      await fixture.database.insert(user).values({
        id: "u",
        name: "Person",
        email: "person@example.test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    afterEach(async () => {
      await Promise.all(runners.splice(0).map((runner) => runner.stop()));
    });
    afterAll(async () => {
      await utils?.release();
      await fixture?.client.close();
    });

    it("persists cloud consumer work before the runner starts, then loads latest state", async () => {
      const enqueue = async (name: string, body: unknown, spec = {}) =>
        addWorkerJobUsing(fixture.database, name, body, spec);
      const publisher = createEventPublisher({
        routes: crmEventRoutes("configured"),
        enqueue,
        diagnostics() {},
      });
      await publisher.publish(userCreated("u", false));
      expect((await fixture.client.query("SELECT id FROM graphile_worker.jobs")).rows).toHaveLength(
        1,
      );
      await fixture.database
        .update(user)
        .set({ email: "latest@example.test" })
        .where(eq(user.id, "u"));
      const remote = adapter();
      await start(task(remote));
      await until(async () => (await store.read(key))?.outcome === "synced");
      expect(remote.updateContact.mock.calls[0][0].fields.email).toBe("latest@example.test");
      expect(crmEventRoutes("disabled")).toEqual([]);
    });

    it("keeps actual committed auth signup successful when the cloud consumer rejects enqueue", async () => {
      const log = vi.fn();
      const publisher = createEventPublisher({
        routes: crmEventRoutes("configured"),
        enqueue: async () => {
          throw new Error("enqueue unavailable");
        },
        diagnostics: log,
      });
      const auth = createIdentityTestAuth(fixture.database, publisher);
      const signup = await auth.api.signUpEmail({
        body: {
          name: "Fixture",
          email: "signup@example.test",
          password: "task07-password-long-enough",
        },
      });
      expect(
        (await fixture.client.query('SELECT id FROM "user" WHERE id = $1', [signup.user.id])).rows,
      ).toEqual([{ id: signup.user.id }]);
      expect(
        (
          await fixture.client.query("SELECT user_id FROM account WHERE user_id = $1", [
            signup.user.id,
          ])
        ).rows,
      ).toEqual([{ user_id: signup.user.id }]);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "subscriber",
          subscriberId: "identity.user.created",
        }),
      );
    });

    it("serializes source load, HTTP and outcome across two independent runners", async () => {
      let release!: () => void;
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const emails: string[] = [];
      const remote = adapter();
      remote.updateContact.mockImplementation(async (snapshot) => {
        emails.push(snapshot.fields.email);
        if (emails.length === 1) {
          entered();
          await gate;
        }
        return { ok: true, value: undefined };
      });
      await start(task(remote));
      await start(task(remote));
      await utils.addJob(USER_SYNC_TASK, payload(), userSyncSpec("u"));
      await enteredPromise;
      await fixture.database
        .update(user)
        .set({ email: "new@example.test" })
        .where(eq(user.id, "u"));
      await utils.addJob(USER_SYNC_TASK, { ...payload(), eventId: "new-event" }, userSyncSpec("u"));
      await delay(120);
      expect(emails).toEqual(["person@example.test"]);
      release();
      await until(async () => (await store.read(key))?.outcome === "synced");
      expect(emails).toEqual(["person@example.test", "new@example.test"]);
      expect((await store.read(key))?.desiredRevision).toBe(2);
    });

    it("captures deletion during HTTP and never acknowledges or recreates a tombstoned user", async () => {
      const remote = adapter();
      remote.updateContact.mockImplementation(async () => {
        await fixture.database.delete(user).where(eq(user.id, "u"));
        return { ok: true, value: undefined };
      });
      const helper = helpers();
      await task(remote)(payload(), helper);
      expect(helper.addJob).toHaveBeenCalledOnce();
      const saved = await store.read(key);
      expect(saved).toMatchObject({ outcome: "pending", syncedRevision: null, remoteId: "42" });
      await fixture.database.insert(user).values({
        id: "u",
        name: "Reused",
        email: "reused@example.test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      remote.getContact.mockClear();
      await task(remote)(payload(), helpers());
      expect((await store.read(key))?.outcome).toBe("synced");
      expect(remote.getContact).toHaveBeenCalledOnce();
      expect(remote.createContact).not.toHaveBeenCalled();
    });

    it("does not create a missing source and rechecks deletion during lookup", async () => {
      const remote = adapter();
      remote.getContact.mockImplementation(async () => {
        await fixture.database.delete(user).where(eq(user.id, "u"));
        return { ok: false, kind: "not_found", code: "not_found" } as never;
      });
      const helper = helpers();
      await task(remote)(payload(), helper);
      expect(remote.createContact).not.toHaveBeenCalled();
      expect(helper.addJob).toHaveBeenCalledOnce();
      await task(remote)(payload(), helpers());
      expect((await store.read(key))?.outcome).toBe("synced");
    });

    it("retains an accepted remote ID on an ambiguous create and recovers by ext_id", async () => {
      const remote = adapter();
      remote.getContact.mockResolvedValueOnce({
        ok: false,
        kind: "not_found",
        code: "not_found",
      } as never);
      remote.createContact.mockResolvedValueOnce({
        ok: false,
        kind: "ambiguous_create",
        code: "transport_failure",
        remoteId: "42",
      } as never);
      const helper = helpers();
      await task(remote)(payload(), helper);
      expect((await store.read(key))?.remoteId).toBe("42");
      await task(remote)(payload(), helpers());
      expect(remote.createContact).toHaveBeenCalledOnce();
      expect((await store.read(key))?.outcome).toBe("synced");
    });

    it.each(["paused", "rate_limited"])(
      "preserves retry budget and pending work on %s",
      async (kind) => {
        const remote = adapter();
        const retryAt = new Date(Date.now() + 3600_000);
        remote.getContact.mockResolvedValueOnce({
          ok: false,
          kind,
          code: "deferred",
          retryAt,
        } as never);
        const helper = helpers();
        await seedFailures(7);
        await task(remote)(payload(), helper);
        expect(helper.addJob).toHaveBeenCalledWith(
          USER_SYNC_TASK,
          expect.objectContaining({ userId: "u" }),
          expect.objectContaining({ runAt: retryAt }),
        );
        expect((await store.read(key))?.outcome).toBe("pending");
        expect((await store.read(key))?.retryFailures).toBe(7);
      },
    );

    it("persists retry backoff and retains exhausted work in Graphile", async () => {
      const remote = adapter();
      remote.getContact.mockResolvedValue({
        ok: false,
        kind: "transient",
        code: "transport_failure",
      } as never);
      const helper = helpers();
      await seedFailures(2);
      await task(remote)(payload(), helper);
      const spec = helper.addJob.mock.calls[0][2]!;
      expect(helper.addJob.mock.calls[0][1]).not.toHaveProperty("failures");
      expect(spec.runAt!.getTime()).toBeGreaterThan(Date.now() + 7000);
      await seedFailures(8);
      await utils.addJob(USER_SYNC_TASK, payload(), userSyncSpec("u"));
      await start(task(remote));
      await until(
        async () =>
          (
            await fixture.client.query(
              "SELECT id FROM graphile_worker.jobs WHERE attempts = max_attempts AND last_error IS NOT NULL",
            )
          ).rows.length === 1,
      );
      expect((await store.read(key))?.outcome).toBe("failed");
      expect(remote.getContact).toHaveBeenCalledOnce();
      // A process can die after Graphile unlocks and before the terminal listener caps retries.
      // Reexecution still inspects the persisted budget before any provider request.
      await expect(task(remote)(payload(), helpers())).rejects.toThrow("requires inspection");
      // A newly admitted event for the same desired revision cannot reset exhaustion.
      await expect(task(remote)(payload(), helpers())).rejects.toThrow("requires inspection");
      expect(remote.getContact).toHaveBeenCalledOnce();
    });

    it.each([2, 7, 3])(
      "uses the durable retry count %s for transient failures",
      async (durable) => {
        await seedFailures(durable);
        const remote = adapter();
        remote.getContact.mockResolvedValue({
          ok: false,
          kind: "transient",
          code: "transport_failure",
        });
        const helper = helpers();
        await task(remote)(payload(), helper);
        expect(remote.getContact).toHaveBeenCalledOnce();
        expect((await store.read(key))?.retryFailures).toBe(durable + 1);
        const next = helper.addJob.mock.calls[0][1];
        expect(next).toMatchObject({ version: 1 });
        expect(next).not.toHaveProperty("failures");
        expect(next).not.toHaveProperty("desiredRevision");
      },
    );

    it("rejects new commands when durable work is exhausted", async () => {
      await seedFailures(8);
      const remote = adapter();
      await expect(task(remote)(payload(), helpers())).rejects.toThrow("requires inspection");
      expect(remote.getContact).not.toHaveBeenCalled();
      expect((await store.read(key))?.retryFailures).toBe(8);
    });

    it("recovers the guarded revision once and preserves retries on recovery replay", async () => {
      await seedFailures(8);
      const remote = adapter();
      remote.getContact.mockResolvedValue({
        ok: false,
        kind: "transient",
        code: "transport_failure",
      });
      const body = {
        ...payload(),
        eventType: "crm.recovery.requested" as const,
        recoverExhaustedRevision: 1,
      };
      await task(remote)(body, helpers());
      expect(await store.read(key)).toMatchObject({ desiredRevision: 2, retryFailures: 1 });
      await task(remote)(body, helpers());
      expect(await store.read(key)).toMatchObject({ desiredRevision: 2, retryFailures: 2 });
      expect(remote.getContact).toHaveBeenCalledTimes(2);
    });

    it("spends an unknown crashed reservation and reports it on infrastructure retry", async () => {
      await seedFailures(7);
      const remote = adapter();
      remote.getContact.mockRejectedValue(new Error("private unknown transport outcome"));
      const diagnostic = vi.fn();
      const body = payload();
      await expect(task(remote, diagnostic)(body, helpers())).rejects.toThrow(
        "CRM coordination failed",
      );
      expect((await store.read(key))?.retryFailures).toBe(8);
      expect(diagnostic).toHaveBeenLastCalledWith("retry", body, "manual-test", 8);
      await expect(task(remote, diagnostic)(body, helpers())).rejects.toThrow(
        "requires inspection",
      );
      expect(remote.getContact).toHaveBeenCalledOnce();
      expect(diagnostic).toHaveBeenLastCalledWith("exhausted", body, "manual-test", 8);
    });

    it("a stale same-revision refund cannot affect a later reserved attempt", async () => {
      const saved = await seedFailures(2);
      expect(await store.setRetryFailures(key, saved.desiredRevision, 2, 3)).toBe(true);
      expect(await store.setRetryFailures(key, saved.desiredRevision, 3, 4)).toBe(true);
      expect(await store.setRetryFailures(key, saved.desiredRevision, 3, 2)).toBe(false);
      expect((await store.read(key))?.retryFailures).toBe(4);
      await fixture.database.update(user).set({ name: "New revision" }).where(eq(user.id, "u"));
      const newer = await store.desire(
        await createCrmSnapshotReader(fixture.database, "test").user("u"),
      );
      expect(await store.setRetryFailures(key, newer.desiredRevision, 0, 1)).toBe(true);
      expect(await store.setRetryFailures(key, saved.desiredRevision, 4, 3)).toBe(false);
      expect((await store.read(key))?.retryFailures).toBe(1);
    });

    it("omits the old count if a source revision reset commits before its readback fails", async () => {
      await seedFailures(6);
      const remote = adapter();
      remote.getContact.mockImplementationOnce(async () => {
        await fixture.database.update(user).set({ name: "New source" }).where(eq(user.id, "u"));
        return { ok: true, value: contact() };
      });
      const original = store.desire;
      vi.spyOn(store, "desire")
        .mockImplementationOnce(original)
        .mockImplementationOnce(async (snapshot) => {
          await original(snapshot);
          throw new Error("private lost revision readback");
        });
      const diagnostic = vi.fn();
      const body = payload();
      await expect(task(remote, diagnostic)(body, helpers())).rejects.toThrow(
        "CRM coordination failed",
      );
      expect(await store.read(key)).toMatchObject({ desiredRevision: 2, retryFailures: 0 });
      expect(diagnostic).toHaveBeenLastCalledWith("retry", body, "manual-test", undefined);
      vi.restoreAllMocks();
    });

    it.each(["recoverExhausted", "verifyRemote"] as const)(
      "omits the old count after an uncertain %s reset",
      async (operation) => {
        await seedFailures(operation === "recoverExhausted" ? 8 : 5);
        if (operation === "verifyRemote") await store.markSynced(key, 1);
        const original = store[operation];
        vi.spyOn(store, operation).mockImplementationOnce(
          async (key: Parameters<typeof store.recoverExhausted>[0], revision: number) => {
            await original(key, revision, "check");
            throw new Error("private lost instruction readback");
          },
        );
        const remote = adapter();
        const diagnostic = vi.fn();
        const body: UserSyncPayload = {
          ...payload(),
          eventType:
            operation === "recoverExhausted"
              ? "crm.recovery.requested"
              : "crm.reconciliation.requested",
          ...(operation === "recoverExhausted"
            ? { recoverExhaustedRevision: 1 }
            : { verifyRemoteRevision: 1 }),
        };
        await expect(task(remote, diagnostic)(body, helpers())).rejects.toThrow(
          "CRM coordination failed",
        );
        expect(await store.read(key)).toMatchObject({ desiredRevision: 2, retryFailures: 0 });
        expect(diagnostic).toHaveBeenLastCalledWith("retry", body, "manual-test", undefined);
        expect(remote.getContact).not.toHaveBeenCalled();
        vi.restoreAllMocks();
      },
    );

    it("rejects invalid persisted payloads before loading or calling the provider", async () => {
      const remote = adapter();
      await utils.addJob(
        USER_SYNC_TASK,
        { userId: "u", email: "private@example.test" },
        userSyncSpec("u"),
      );
      await start(task(remote));
      await until(
        async () =>
          (
            await fixture.client.query(
              "SELECT id FROM graphile_worker.jobs WHERE attempts = max_attempts",
            )
          ).rows.length === 1,
      );
      expect(remote.getContact).not.toHaveBeenCalled();
      expect(await store.read(key)).toBeUndefined();
    });

    it("retains the final allowance when successor persistence fails, before native retry", async () => {
      const remote = adapter();
      remote.getContact.mockResolvedValue({
        ok: false,
        kind: "transient",
        code: "transport_failure",
      });
      const handler = task(remote);
      await start((body, helper) =>
        handler(body, {
          ...helper,
          addJob: async () => {
            throw new Error("private continuation parameters");
          },
        }),
      );
      await seedFailures(7);
      await utils.addJob(USER_SYNC_TASK, payload(), userSyncSpec("u"));
      await until(
        async () =>
          (
            await fixture.client.query(
              "SELECT id FROM graphile_worker.jobs WHERE attempts = 1 AND last_error IS NOT NULL",
            )
          ).rows.length === 1,
      );
      expect((await store.read(key))?.retryFailures).toBe(8);
      const [failed] = (
        await fixture.client.query<{ id: string; last_error: string }>(
          "SELECT id, last_error FROM graphile_worker.jobs",
        )
      ).rows;
      expect(failed.last_error).not.toContain("private continuation");
      await utils.rescheduleJobs([failed.id], { runAt: new Date() });
      await until(
        async () =>
          (
            await fixture.client.query(
              "SELECT id FROM graphile_worker.jobs WHERE attempts = max_attempts",
            )
          ).rows.length === 1,
      );
      expect(remote.getContact).toHaveBeenCalledOnce();
      expect(await store.read(key)).toMatchObject({
        retryFailures: 8,
        lastErrorCode: "retry_budget_exhausted",
      });
    });

    it("does not carry an exhausted old revision into changed desired state", async () => {
      await store.desire(await createCrmSnapshotReader(fixture.database, "test").user("u"));
      expect(await store.setRetryFailures(key, 1, 0, 8)).toBe(true);
      await fixture.database
        .update(user)
        .set({ email: "changed@example.test" })
        .where(eq(user.id, "u"));
      const remote = adapter();
      await task(remote)(payload(), helpers());
      expect(remote.updateContact).toHaveBeenCalledOnce();
      expect(await store.read(key)).toMatchObject({
        desiredRevision: 2,
        retryFailures: 0,
        outcome: "synced",
      });
    });

    it("keeps native retry when successor persistence fails, without replenishing the durable allowance", async () => {
      const remote = adapter();
      const handler = task(remote);
      let first = true;
      await start(async (body, helper) => {
        if (first) {
          first = false;
          remote.getContact.mockResolvedValueOnce({
            ok: false,
            kind: "rate_limited",
            code: "local_budget",
            retryAt: new Date(Date.now() + 3600_000),
          });
          await handler(body, {
            ...helper,
            addJob: async () => {
              throw new Error("private SQL parameters");
            },
          });
        } else await handler(body, helper);
      });
      await seedFailures(7);
      await utils.addJob(USER_SYNC_TASK, payload(), userSyncSpec("u"));
      await until(
        async () =>
          (
            await fixture.client.query(
              "SELECT id FROM graphile_worker.jobs WHERE attempts = 1 AND attempts < max_attempts AND last_error IS NOT NULL",
            )
          ).rows.length === 1,
      );
      const [failed] = (
        await fixture.client.query<{ id: string; last_error: string }>(
          "SELECT id, last_error FROM graphile_worker.jobs",
        )
      ).rows;
      expect(failed.last_error).not.toContain("private SQL");
      expect(remote.getContact).toHaveBeenCalledOnce();
      await utils.rescheduleJobs([failed.id], { runAt: new Date() });
      await until(async () => (await store.read(key))?.outcome === "synced");
      expect(remote.updateContact).toHaveBeenCalledOnce();
    });
  },
);
