// @vitest-environment node
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { JobHelpers } from "graphile-worker";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  USER_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  MEMBERSHIP_SYNC_TASK,
  userSyncPayload,
  organizationSyncPayload,
  membershipSyncPayload,
  userSyncSpec,
  relatedSyncSpec,
} from "./commands";
import { RetainedCrmWork } from "./coordination";
import { createCrmTaskList } from "./task-list";

vi.mock("@everr/app/db/client", () => ({ db: undefined }));
vi.mock("../app/env", () => ({ appEnv: { POLAR_PRO_PRODUCT_ID: "product_pro" } }));
afterEach(() => vi.restoreAllMocks());

const common = {
  version: 1,
  eventId: "event",
  eventType: "identity.user.updated",
  occurredAt: "2026-10-25T12:00:00Z",
};
const entries = [
  { name: USER_SYNC_TASK, schema: userSyncPayload, body: { ...common, userId: "u" }, kind: "user" },
  {
    name: ORGANIZATION_SYNC_TASK,
    schema: organizationSyncPayload,
    body: { ...common, kind: "organization", organizationId: "o" },
    kind: "organization",
  },
  {
    name: MEMBERSHIP_SYNC_TASK,
    schema: membershipSyncPayload,
    body: { ...common, kind: "membership", organizationId: "o", userId: "u" },
    kind: "membership",
  },
] as const;

function fixture(kind: string, deleted = false) {
  const snapshot = { kind, sourceId: kind === "user" ? "u" : "o", deleted, memberships: [] };
  const saved = {
    ...snapshot,
    desired: snapshot,
    desiredRevision: 1,
    syncedRevision: 1,
    retryFailures: 0,
    deletedAt: deleted ? new Date() : null,
  };
  const reader = {
    user: vi.fn(async () => snapshot),
    organization: vi.fn(async () => snapshot),
    membership: vi.fn(async () => snapshot),
  };
  const store = {
    desire: vi.fn(async () => saved),
    memberships: vi.fn(async () => [] as { userId: string; organizationId: string }[]),
    read: vi.fn(async () => undefined),
    setRetryFailures: vi.fn(async () => true),
  };
  const adapter = { getContact: vi.fn(), getCompany: vi.fn(), associate: vi.fn() };
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
    release: vi.fn(),
  });
  const pool = { connect: vi.fn(async () => client) };
  const diagnostic = vi.fn();
  const tasks = createCrmTaskList({
    pool,
    deployment: "test",
    reader,
    store,
    adapter,
    diagnostic,
  } as unknown as Parameters<typeof createCrmTaskList>[0]);
  const addJob = vi.fn();
  const invoke = (name: string, raw: unknown) =>
    tasks[name]!(raw, {
      addJob,
      job: { id: "job", task_identifier: name, attempts: 1, max_attempts: 8 },
    } as unknown as JobHelpers);
  return { saved, reader, store, adapter, client, pool, diagnostic, addJob, invoke };
}

it.each(entries)(
  "validates $name once through the actual worker entry",
  async ({ name, schema, body, kind }) => {
    const state = fixture(kind);
    const parse = vi.spyOn(schema, "safeParse");
    const parseThrowing = vi.spyOn(schema, "parse");
    await state.invoke(name, body);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parseThrowing).not.toHaveBeenCalled();
    expect(state.store.desire).toHaveBeenCalledOnce();
    expect(state.diagnostic).toHaveBeenCalledWith("synced", body, "job", 0);
    expect(state.client.release).toHaveBeenCalledWith(false);
  },
);

it.each(entries)(
  "retains invalid $name before any pool, source or provider work",
  async ({ name, body, kind }) => {
    const state = fixture(kind);
    for (const raw of [
      null,
      { ...body, email: "private@example.test" },
      { ...body, failures: 0 },
      { ...body, desiredRevision: 1 },
      { ...body, eventType: "" },
      { ...body, eventType: "x".repeat(129) },
      { ...body, eventType: 123 },
    ]) {
      await expect(state.invoke(name, raw)).rejects.toBeInstanceOf(RetainedCrmWork);
    }
    expect(state.diagnostic.mock.calls).toEqual(
      Array.from({ length: 7 }, () => ["invalid", undefined, "job"]),
    );
    expect(state.pool.connect).not.toHaveBeenCalled();
    for (const read of Object.values(state.reader)) expect(read).not.toHaveBeenCalled();
    expect(state.store.desire).not.toHaveBeenCalled();
    for (const request of Object.values(state.adapter)) expect(request).not.toHaveBeenCalled();
  },
);

it.each(entries.slice(0, 2))(
  "uses the one validated $name snapshot for deletion and fanout",
  async ({ name, body, schema, kind }) => {
    const state = fixture(kind, true);
    state.store.memberships.mockResolvedValue([{ userId: "u", organizationId: "o" }]);
    const parse = vi.spyOn(schema, "safeParse");
    const parseThrowing = vi.spyOn(schema, "parse");
    await state.invoke(name, body);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parseThrowing).not.toHaveBeenCalled();
    expect(state.addJob).toHaveBeenCalledWith(
      MEMBERSHIP_SYNC_TASK,
      expect.objectContaining({ eventId: body.eventId, userId: "u", organizationId: "o" }),
      relatedSyncSpec("o", "u"),
    );
  },
);

it("keeps execution and lock IDs stable when the original raw object mutates during acquisition", async () => {
  const state = fixture("user");
  const parse = vi.spyOn(userSyncPayload, "safeParse");
  const parseThrowing = vi.spyOn(userSyncPayload, "parse");
  const raw = { ...common, userId: "u" };
  let acquire!: () => void;
  state.pool.connect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acquire = () => resolve(state.client);
      }),
  );
  const execution = state.invoke(USER_SYNC_TASK, raw);
  raw.userId = "changed";
  raw.eventId = "changed";
  acquire();
  await execution;
  const hash = createHash("sha256")
    .update(JSON.stringify(["test", JSON.stringify(["user", "u"])]))
    .digest();
  expect(state.client.query.mock.calls[0]).toEqual([
    "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
    [hash.readInt32BE(0), hash.readInt32BE(4)],
  ]);
  expect(state.reader.user).toHaveBeenCalledWith("u");
  expect(state.diagnostic).toHaveBeenCalledWith("synced", { ...common, userId: "u" }, "job", 0);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(parseThrowing).not.toHaveBeenCalled();
});

it.each(entries)(
  "requeues the stable $name snapshot on contention without spending provider allowance",
  async ({ name, body, schema, kind }) => {
    const state = fixture(kind);
    const parse = vi.spyOn(schema, "safeParse");
    const parseThrowing = vi.spyOn(schema, "parse");
    const raw = { ...body };
    let acquire!: () => void;
    state.pool.connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acquire = () => resolve(state.client);
        }),
    );
    state.client.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const execution = state.invoke(name, raw);
    Object.assign(raw, {
      userId: "changed",
      organizationId: "changed",
      eventId: "changed",
    });
    acquire();
    await execution;
    const spec =
      name === USER_SYNC_TASK
        ? userSyncSpec("u")
        : relatedSyncSpec("o", name === MEMBERSHIP_SYNC_TASK ? "u" : undefined);
    expect(state.addJob).toHaveBeenCalledWith(name, body, { ...spec, runAt: expect.any(Date) });
    expect(state.addJob.mock.calls[0][1]).not.toBe(raw);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parseThrowing).not.toHaveBeenCalled();
    expect(state.store.desire).not.toHaveBeenCalled();
    expect(state.store.setRetryFailures).not.toHaveBeenCalled();
    for (const request of Object.values(state.adapter)) expect(request).not.toHaveBeenCalled();
  },
);

it.each(entries)(
  "sanitizes $name source errors without parsing the raw job again",
  async ({ name, body, schema, kind }) => {
    const state = fixture(kind);
    const parse = vi.spyOn(schema, "safeParse");
    const parseThrowing = vi.spyOn(schema, "parse");
    state.store.desire.mockRejectedValueOnce(new Error("private SQL parameters"));
    await expect(state.invoke(name, body)).rejects.toThrow(
      "CRM coordination failed; persisted work remains available for retry.",
    );
    expect(state.diagnostic).toHaveBeenCalledWith("retry", body, "job", undefined);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parseThrowing).not.toHaveBeenCalled();
  },
);

it.each(entries.slice(0, 2))(
  "rejects a $name cleanup command for another source identity",
  async ({ name, body, kind }) => {
    const state = fixture(kind, true);
    const other =
      name === USER_SYNC_TASK ? { ...body, userId: "other" } : { ...body, organizationId: "other" };
    await expect(state.invoke(name, other)).rejects.toThrow("CRM coordination failed");
    expect(state.store.memberships).not.toHaveBeenCalled();
    for (const request of Object.values(state.adapter)) expect(request).not.toHaveBeenCalled();
  },
);

it("rejects a User cleanup command for an Organization tombstone", async () => {
  const state = fixture("organization", true);
  await expect(state.invoke(USER_SYNC_TASK, { ...common, userId: "o" })).rejects.toThrow(
    "CRM coordination failed",
  );
  expect(state.store.memberships).not.toHaveBeenCalled();
  for (const request of Object.values(state.adapter)) expect(request).not.toHaveBeenCalled();
});

it.each(["user", "organization"])(
  "omits unknown %s budget after reservation CAS rejection without diagnostic reads",
  async (kind) => {
    const entry = entries.find((entry) => entry.kind === kind)!;
    const state = fixture(kind);
    state.saved.syncedRevision = 0;
    state.store.setRetryFailures.mockResolvedValueOnce(false);
    await state.invoke(entry.name, entry.body);
    expect(state.store.read).not.toHaveBeenCalled();
    expect(state.diagnostic).toHaveBeenLastCalledWith("deferred", entry.body, "job", undefined);
    expect(state.adapter.getContact).not.toHaveBeenCalled();
    expect(state.adapter.getCompany).not.toHaveBeenCalled();
    const next = state.addJob.mock.calls[0][1];
    expect(next).not.toHaveProperty("failures");
    expect(next).not.toHaveProperty("desiredRevision");
  },
);
