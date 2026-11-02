import { serverLogger } from "#app/telemetry/logger.ts";
// @vitest-environment node
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";
import type { EventDefinition, EventPublisher } from "#app/composition/events.ts";
import { createEventPublisher } from "#app/server/events/publisher.ts";
import {
  membershipChanged,
  membershipEventDefinitions,
  organizationChanged,
  organizationEventDefinitions,
  type IdentityEvent,
} from "./events";
import { createApplicationAuth } from "./module";
import { createAuthTestDatabase } from "./testing/database";

const { client, database } = await createAuthTestDatabase(
  process.env.EVERR_IDENTITY_TEST_DATABASE_URL,
);
afterAll(() => client.close());
beforeEach(async () => {
  await client.exec(
    'TRUNCATE "user", account, organization, member, invitation, session, verification CASCADE',
  );
});
const facts: IdentityEvent[] = [];
function createAuth(
  events: EventPublisher<IdentityEvent> = {
    publish: async (fact) => {
      facts.push(fact);
    },
  },
) {
  facts.length = 0;
  return createApplicationAuth(
    {
      policy: {
        beforeUserCreate: async () => {},
        beforeUserDelete: async () => {},
        beforeMembershipChange: async () => {},
        afterMembershipChange: async () => {},
        assertAccountDeletionAllowed: async () => {},
        assertDeletable: async () => {},
      },
      provider: {
        withIdentityRequest: (run) => run(),
        lockUserLifecycle: async () => {},
        lockAccountDeletion: async () => {},
        identityAdapter: (executor) => drizzleAdapter(executor, { provider: "pg" }),
        organizationHooks: () => ({}),
        createSessionOnboardingHook: () => async () => {},
      },
    },
    {
      database,
      events,
      baseURL: "http://localhost:3000",
      secret: "organization-fact-integration-secret-long-enough",
      email: { enabled: false, sendInvitation() {}, sendPasswordReset() {}, sendVerification() {} },
      canInviteMembers: async () => true,
    },
  );
}
type Auth = ReturnType<typeof createAuth>;
async function signup(auth: Auth, name: string) {
  const response = await auth.api.signUpEmail({
    body: { name, email: `${name}@example.test`, password: "long-test-password" },
    asResponse: true,
  });
  const headers = new Headers({ cookie: response.headers.get("set-cookie") ?? "" });
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("Missing signup session");
  return { headers, id: session.user.id };
}
async function createOrganization(auth: Auth, userId: string, slug = "first") {
  const result = await auth.api.createOrganization({ body: { name: slug, slug, userId } });
  if (!result) throw new Error("Missing organization");
  return result;
}
async function memberships() {
  return (
    await client.query<{ id: string; organizationId: string; userId: string }>(
      'SELECT id, organization_id AS "organizationId", user_id AS "userId" FROM member ORDER BY id',
    )
  ).rows;
}

it("publishes actual organization mutations and invitation, role, removal, and leave facts scoped to each membership", async () => {
  const auth = createAuth();
  const owner = await signup(auth, "owner");
  const invitee = await signup(auth, "invitee");
  const first = await createOrganization(auth, owner.id);
  const second = await createOrganization(auth, owner.id, "second");
  expect(facts.filter((fact) => fact.type === "organization.created")).toEqual([
    organizationChanged("organization.created", first.id),
    organizationChanged("organization.created", second.id),
  ]);
  await auth.api.updateOrganization({
    headers: owner.headers,
    body: { organizationId: first.id, data: { name: "Renamed" } },
  });
  expect(facts.at(-1)).toEqual(organizationChanged("organization.updated", first.id));
  for (const org of [first, second]) {
    const invitation = await auth.api.createInvitation({
      headers: owner.headers,
      body: { organizationId: org.id, email: "invitee@example.test", role: "member" },
    });
    facts.length = 0;
    await auth.api.acceptInvitation({
      headers: invitee.headers,
      body: { invitationId: invitation.id },
    });
    const membership = (await memberships()).find(
      (row) => row.organizationId === org.id && row.userId === invitee.id,
    );
    if (!membership) throw new Error("Missing invited membership");
    expect(facts.filter((fact) => fact.type.startsWith("membership."))).toEqual([
      membershipChanged("membership.added", membership),
    ]);
    facts.length = 0;
    await expect(
      auth.api.acceptInvitation({
        headers: invitee.headers,
        body: { invitationId: invitation.id },
      }),
    ).rejects.toThrow();
    expect(facts).toEqual([]);
  }
  const [one, two] = [first, second].map((org) => org.id);
  const rows = await memberships();
  const firstMember = rows.find((row) => row.organizationId === one && row.userId === invitee.id)!;
  const secondMember = rows.find((row) => row.organizationId === two && row.userId === invitee.id)!;
  expect(firstMember.id).not.toBe(secondMember.id);
  await auth.api.updateMemberRole({
    headers: owner.headers,
    body: { organizationId: one, memberId: firstMember.id, role: "admin" },
  });
  expect(facts.at(-1)).toEqual(membershipChanged("membership.updated", firstMember));
  await auth.api.removeMember({
    headers: owner.headers,
    body: { organizationId: one, memberIdOrEmail: firstMember.id },
  });
  expect(facts.at(-1)).toEqual(membershipChanged("membership.removed", firstMember));
  await auth.api.leaveOrganization({ headers: invitee.headers, body: { organizationId: two } });
  expect(facts.at(-1)).toEqual(membershipChanged("membership.removed", secondMember));
  expect((await memberships()).filter((row) => row.userId === invitee.id)).toEqual([]);
});

it("keeps nested organization and membership facts private until root commit, and drops all facts on rollback", async () => {
  const publicationReads: Promise<{ rows: { id: string }[] }>[] = [];
  const auth = createAuth({
    publish: async (fact) => {
      facts.push(fact);
      if (fact.type === "organization.created")
        publicationReads.push(
          client.query<{ id: string }>("SELECT id FROM organization WHERE id = $1", [
            fact.subjectId,
          ]),
        );
      if (fact.type === "membership.added")
        publicationReads.push(
          client.query<{ id: string }>("SELECT id FROM member WHERE id = $1", [fact.subjectId]),
        );
    },
  });
  const owner = await signup(auth, "owner");
  const { adapter } = await auth.$context;
  facts.length = 0;
  await adapter.transaction(async (outer) => {
    await (outer as typeof adapter).transaction(async (inner) => {
      expect(
        await inner.create({
          model: "organization",
          data: { id: "nested", name: "Nested", slug: "nested", createdAt: new Date() },
          forceAllowId: true,
          select: ["name"],
        }),
      ).toEqual({ name: "Nested" });
      expect(
        await inner.create({
          model: "member",
          data: {
            id: "nested-member",
            organizationId: "nested",
            userId: owner.id,
            role: "owner",
            createdAt: new Date(),
          },
          forceAllowId: true,
          select: ["role"],
        }),
      ).toEqual({ role: "owner" });
      expect(facts).toEqual([]);
    });
    expect(facts).toEqual([]);
  });
  expect(facts.map((fact) => fact.type)).toEqual(["organization.created", "membership.added"]);
  // The PostgreSQL run observes committed rows through another pool connection.
  expect((await Promise.all(publicationReads)).map(({ rows }) => rows)).toEqual([
    [{ id: "nested" }],
    [{ id: "nested-member" }],
  ]);
  facts.length = 0;
  await expect(
    adapter.transaction(async (outer) => {
      await (outer as typeof adapter).transaction(async (inner) => {
        await inner.update({
          model: "organization",
          where: [{ field: "id", value: "nested" }],
          update: { name: "Rolled back" },
        });
        await inner.update({
          model: "member",
          where: [{ field: "id", value: "nested-member" }],
          update: { role: "admin" },
        });
        await inner.deleteMany({
          model: "member",
          where: [{ field: "organizationId", value: "nested" }],
        });
        await inner.delete({ model: "organization", where: [{ field: "id", value: "nested" }] });
        expect(facts).toEqual([]);
      });
      throw new Error("rollback source");
    }),
  ).rejects.toThrow("rollback source");
  expect(facts).toEqual([]);
  expect((await client.query("SELECT name FROM organization")).rows).toEqual([{ name: "Nested" }]);
  expect((await client.query("SELECT role FROM member")).rows).toEqual([{ role: "owner" }]);
});

it("preserves all matching rows for single adapter update and delete operations", async () => {
  const auth = createAuth();
  const owner = await signup(auth, "owner");
  const first = await createOrganization(auth, owner.id);
  const second = await createOrganization(auth, owner.id, "second");
  const untouched = await createOrganization(auth, owner.id, "untouched");
  const ids = [first.id, second.id];
  const before = (await memberships()).filter((row) => ids.includes(row.organizationId));
  const { adapter } = await auth.$context;
  const expectFacts = (expected: IdentityEvent[]) => {
    expect(facts).toHaveLength(expected.length);
    expect(facts).toEqual(expect.arrayContaining(expected));
  };

  facts.length = 0;
  await adapter.update({
    model: "organization",
    where: [{ field: "id", operator: "in", value: ids }],
    update: { name: "Renamed" },
  });
  expect((await client.query("SELECT name FROM organization ORDER BY name")).rows).toEqual([
    { name: "Renamed" },
    { name: "Renamed" },
    { name: "untouched" },
  ]);
  expectFacts(ids.map((id) => organizationChanged("organization.updated", id)));

  const memberWhere = [{ field: "organizationId", operator: "in" as const, value: ids }];
  facts.length = 0;
  await adapter.update({ model: "member", where: memberWhere, update: { role: "admin" } });
  expect((await client.query("SELECT role FROM member ORDER BY role")).rows).toEqual([
    { role: "admin" },
    { role: "admin" },
    { role: "owner" },
  ]);
  expectFacts(before.map((row) => membershipChanged("membership.updated", row)));

  facts.length = 0;
  await adapter.delete({ model: "member", where: memberWhere });
  expect((await memberships()).map((row) => row.organizationId)).toEqual([untouched.id]);
  expectFacts(before.map((row) => membershipChanged("membership.removed", row)));

  facts.length = 0;
  await adapter.delete({ model: "organization", where: [{ field: "name", value: "Renamed" }] });
  expect((await client.query("SELECT id FROM organization")).rows).toEqual([{ id: untouched.id }]);
  expectFacts(ids.map((id) => organizationChanged("organization.deleted", id)));
});

it("retains the committed organization fact when the separately persisted creator membership fails", async () => {
  const auth = createAuth();
  const owner = await signup(auth, "owner");
  facts.length = 0;
  await client.exec("ALTER TABLE member ADD CONSTRAINT reject_member CHECK (role <> 'owner')");
  try {
    await expect(createOrganization(auth, owner.id)).rejects.toThrow();
    const [organization] = (await client.query<{ id: string }>("SELECT id FROM organization")).rows;
    expect(organization).toBeTruthy();
    expect(await memberships()).toEqual([]);
    expect(facts).toEqual([organizationChanged("organization.created", organization.id)]);
  } finally {
    await client.exec("ALTER TABLE member DROP CONSTRAINT reject_member");
  }
});

it("captures actual membership IDs before endpoint parent deletion and leaves other organizations intact", async () => {
  const auth = createAuth();
  const owner = await signup(auth, "owner");
  const first = await createOrganization(auth, owner.id);
  const second = await createOrganization(auth, owner.id, "second");
  const before = await memberships();
  const deleted = before.filter((row) => row.organizationId === first.id);
  facts.length = 0;
  await auth.api.deleteOrganization({ headers: owner.headers, body: { organizationId: first.id } });
  expect(facts).toEqual([
    ...deleted.map((row) => membershipChanged("membership.removed", row)),
    organizationChanged("organization.deleted", first.id),
  ]);
  expect(await memberships()).toEqual(before.filter((row) => row.organizationId === second.id));
});

it("uses parent cleanup facts for database cascades without fabricating membership removals", async () => {
  const auth = createAuth();
  const owner = await signup(auth, "owner");
  const first = await createOrganization(auth, owner.id);
  const second = await createOrganization(auth, owner.id, "second");
  facts.length = 0;
  const { adapter } = await auth.$context;
  await adapter.delete({ model: "organization", where: [{ field: "id", value: first.id }] });
  expect(facts).toEqual([organizationChanged("organization.deleted", first.id)]);
  expect((await memberships()).map((row) => row.organizationId)).toEqual([second.id]);
  facts.length = 0;
  await adapter.delete({ model: "user", where: [{ field: "id", value: owner.id }] });
  expect(facts.map((fact) => fact.type)).toEqual(["identity.user.deleted"]);
  expect(await memberships()).toEqual([]);
  expect((await client.query("SELECT id FROM organization")).rows).toEqual([{ id: second.id }]);
});

it("keeps actual organization and membership mutations committed when subscriber persistence fails", async () => {
  const log = vi.spyOn(serverLogger, "error").mockImplementation(() => {});
  const definitions: EventDefinition<IdentityEvent>[] = [
    ...organizationEventDefinitions,
    ...membershipEventDefinitions,
  ];
  const publisher = createEventPublisher({
    routes: definitions.map((definition) => ({
      definition,
      job: (event) => ({ task: "test/identity", payload: event }),
    })),
    enqueue: async () => {
      throw new Error("queue unavailable");
    },
  });
  const auth = createAuth(publisher);
  const owner = await signup(auth, "owner");
  const first = await createOrganization(auth, owner.id);
  await auth.api.updateOrganization({
    headers: owner.headers,
    body: { organizationId: first.id, data: { name: "Committed" } },
  });
  expect((await client.query("SELECT name FROM organization")).rows).toEqual([
    { name: "Committed" },
  ]);
  expect(await memberships()).toHaveLength(1);
  await auth.api.deleteOrganization({ headers: owner.headers, body: { organizationId: first.id } });
  expect(await memberships()).toEqual([]);
  expect((await client.query("SELECT id FROM organization")).rows).toEqual([]);
  expect(
    log.mock.calls
      .map(([, attributes]) => String(attributes?.["everr.business_event.type"]))
      .sort((a, b) => a.localeCompare(b)),
  ).toEqual([
    "membership.added",
    "membership.removed",
    "organization.created",
    "organization.deleted",
    "organization.updated",
  ]);
  log.mockRestore();
});

it
  .skipIf(!process.env.EVERR_IDENTITY_TEST_DATABASE_URL)
  .each(["delete", "deleteMany", "updateMany"] as const)(
  "revalidates the original %s predicate after waiting for another PostgreSQL writer",
  async (operation) => {
    const auth = createAuth();
    const owner = await signup(auth, "owner");
    const org = await createOrganization(auth, owner.id);
    const { adapter } = await auth.$context;
    await adapter.update({
      model: "member",
      where: [{ field: "organizationId", value: org.id }],
      update: { role: "member" },
    });
    facts.length = 0;
    const blocker = await database.$client.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      const {
        rows: [{ pid }],
      } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query("UPDATE member SET role = 'admin' WHERE organization_id = $1", [org.id]);
      const input = { model: "member", where: [{ field: "role", value: "member" }] };
      pending =
        operation === "updateMany"
          ? adapter.updateMany({ ...input, update: { role: "owner" } })
          : adapter[operation](input);
      await vi.waitFor(async () => {
        const { rows } = await client.query(
          "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
          [pid],
        );
        expect(rows.length).toBeGreaterThan(0);
      });
      expect(facts).toEqual([]);
      await blocker.query("COMMIT");
      await pending;
      expect(facts).toEqual([]);
      expect((await client.query("SELECT role FROM member")).rows).toEqual([{ role: "admin" }]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  },
);

it.each(["update", "updateMany"] as const)(
  "publishes committed Membership endpoints and previous pairs for %s",
  async (operation) => {
    const auth = createAuth();
    const owner = await signup(auth, "owner");
    const other = await signup(auth, "other");
    const first = await createOrganization(auth, owner.id);
    const second = await createOrganization(auth, owner.id, "second");
    const target = await createOrganization(auth, other.id, "target");
    const before = (await memberships()).filter((row) => row.userId === owner.id);
    const { adapter } = await auth.$context;
    facts.length = 0;
    const result = await adapter[operation]({
      model: "member",
      where: [{ field: "organizationId", operator: "in", value: [first.id, second.id] }],
      update: { organizationId: target.id, userId: other.id },
    });
    const updated = expect.objectContaining({ organizationId: target.id, userId: other.id });
    expect(result).toEqual(operation === "updateMany" ? 2 : updated);
    expect(facts).toEqual(
      before.map((row) => ({
        type: "membership.updated",
        version: 1,
        subjectId: row.id,
        data: {
          membershipId: row.id,
          organizationId: target.id,
          userId: other.id,
          previous: { organizationId: row.organizationId, userId: row.userId },
        },
      })),
    );
    expect((await memberships()).filter((row) => before.some((old) => old.id === row.id))).toEqual(
      before.map((row) => ({ ...row, organizationId: target.id, userId: other.id })),
    );
    facts.length = 0;
    await adapter[operation]({
      model: "member",
      where: [{ field: "id", operator: "in", value: before.map((row) => row.id) }],
      update: { role: "admin" },
    });
    expect(facts.every((fact) => !("previous" in fact.data))).toBe(true);
    facts.length = 0;
    await expect(
      adapter.transaction(async (tx) => {
        await tx.updateMany({
          model: "member",
          where: [{ field: "id", operator: "in", value: before.map((row) => row.id) }],
          update: { organizationId: first.id, userId: owner.id },
        });
        expect(facts).toEqual([]);
        throw new Error("rollback membership");
      }),
    ).rejects.toThrow("rollback membership");
    expect(facts).toEqual([]);
  },
);
