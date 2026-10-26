import { serverLogger } from "#app/telemetry/logger.ts";
// @vitest-environment node
import { betterAuth } from "better-auth";
import { eq } from "drizzle-orm";
import { user } from "#app/db/schema/index.ts";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";
import type { EventPublisher } from "#app/composition/events.ts";
import { createEventPublisher } from "#app/server/events/publisher.ts";
import { userEventDefinitions, type UserEvent } from "./events";
import { createAuthTestDatabase } from "./testing/database";
import { identityLifecycleAdapter } from "./identity-adapter";

const { client, database } = await createAuthTestDatabase(
  process.env.EVERR_IDENTITY_TEST_DATABASE_URL,
);
afterAll(() => client.close());
beforeEach(async () => {
  await client.exec('TRUNCATE "user", account, session, verification CASCADE');
});
const input = { name: "Person", email: "person@example.test", password: "long-test-password" };
function createAuth(
  events: EventPublisher<UserEvent>,
  extra: Parameters<typeof betterAuth>[0] = {},
) {
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "user-event-integration-secret-long-enough",
    emailAndPassword: { enabled: true },
    user: { deleteUser: { enabled: true } },
    ...extra,
    database: identityLifecycleAdapter(
      database,
      (executor) => drizzleAdapter(executor, { provider: "pg" }),
      events,
    ),
  });
}
function capture() {
  const facts: UserEvent[] = [];
  return {
    facts,
    events: {
      publish: async (fact: UserEvent) => {
        facts.push(fact);
      },
    },
  };
}

it("publishes password signup, profile, anonymous verification, and deletion from committed rows", async () => {
  const { facts, events } = capture();
  let verificationUrl = "";
  const auth = createAuth(events, {
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ url }) => {
        verificationUrl = url;
      },
    },
  });
  const signup = await auth.api.signUpEmail({ body: input, asResponse: true });
  const headers = new Headers({ cookie: signup.headers.get("set-cookie") ?? "" });
  const [person] = (await client.query<{ id: string }>('SELECT id FROM "user"')).rows;
  expect(facts).toEqual([
    {
      type: "identity.user.created",
      version: 1,
      subjectId: person.id,
      data: { userId: person.id, emailVerified: false },
    },
  ]);
  await auth.api.updateUser({ headers, body: { name: "Changed" } });
  expect(facts.at(-1)?.type).toBe("identity.user.updated");
  const token = new URL(verificationUrl).searchParams.get("token");
  if (!token) throw new Error("Missing verification token");
  await auth.api.verifyEmail({ query: { token } });
  await auth.api.verifyEmail({ query: { token } });
  expect(facts.filter((fact) => fact.type === "identity.email.verified")).toHaveLength(1);
  expect((await client.query('SELECT email_verified FROM "user"')).rows).toEqual([
    { email_verified: true },
  ]);
  await auth.api.deleteUser({ headers, body: { password: input.password } });
  expect((await client.query('SELECT id FROM "user"')).rows).toEqual([]);
  expect(facts.at(-1)).toEqual({
    type: "identity.user.deleted",
    version: 1,
    subjectId: person.id,
    data: { userId: person.id },
  });
});

it("publishes initially verified OAuth creation without fabricating a verification milestone", async () => {
  const { facts, events } = capture();
  const auth = createAuth(events);
  const context = await auth.$context;
  const result = await context.internalAdapter.createOAuthUser(
    { name: "OAuth", email: "oauth@example.test", emailVerified: true },
    { providerId: "github", accountId: "github-person" },
  );
  expect((await client.query("SELECT id FROM account")).rows).toHaveLength(1);
  expect(facts).toEqual([
    {
      type: "identity.user.created",
      version: 1,
      subjectId: result.user.id,
      data: { userId: result.user.id, emailVerified: true },
    },
  ]);
});

it("keeps nested adapter facts private until the outermost source commit and discards rollback facts", async () => {
  const { facts, events } = capture();
  const auth = createAuth(events);
  const { adapter } = await auth.$context;
  await adapter.transaction(async (outer) => {
    await (outer as typeof adapter).transaction(async (inner) => {
      await inner.create({
        model: "user",
        data: {
          ...input,
          id: "nested",
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        forceAllowId: true,
      });
      expect(facts).toEqual([]);
    });
    expect(facts).toEqual([]);
  });
  expect(facts.map((fact) => fact.subjectId)).toEqual(["nested"]);
  facts.length = 0;
  await expect(
    adapter.transaction(async (outer) => {
      await (outer as typeof adapter).transaction(async (inner) => {
        await inner.update({
          model: "user",
          where: [{ field: "id", value: "nested" }],
          update: { emailVerified: true },
        });
        await inner.delete({ model: "user", where: [{ field: "id", value: "nested" }] });
      });
      throw new Error("source failed");
    }),
  ).rejects.toThrow("source failed");
  expect(facts).toEqual([]);
  expect((await client.query('SELECT id, email_verified FROM "user"')).rows).toEqual([
    { id: "nested", email_verified: false },
  ]);
});

it.each(["password", "OAuth"])(
  "does not publish when %s account creation rolls back",
  async (kind) => {
    const { facts, events } = capture();
    const afterCreate = vi.fn();
    const auth = createAuth(events, {
      databaseHooks: { user: { create: { after: afterCreate } } },
    });
    await client.exec(
      "ALTER TABLE account ADD CONSTRAINT reject_account CHECK (provider_id = 'rejected')",
    );
    try {
      const context = await auth.$context;
      const operation =
        kind === "password"
          ? auth.api.signUpEmail({ body: input })
          : context.internalAdapter.createOAuthUser(
              { name: "OAuth", email: "oauth@example.test", emailVerified: true },
              { providerId: "github", accountId: "github-person" },
            );
      await expect(operation).rejects.toThrow();
      expect((await client.query('SELECT id FROM "user"')).rows).toEqual([]);
      expect(facts).toEqual([]);
      // Better Auth 1.6.33 drains these hooks on failure too. They are not a
      // committed-fact boundary, even though its API names them after-hooks.
      expect(afterCreate).toHaveBeenCalledOnce();
    } finally {
      await client.exec("ALTER TABLE account DROP CONSTRAINT reject_account");
    }
  },
);

it("keeps a real committed signup successful when a subscriber fails", async () => {
  const failure = vi.spyOn(serverLogger, "error").mockImplementation(() => {});
  const definition = userEventDefinitions[0];
  const publisher = createEventPublisher({
    routes: [{ definition, job: (event) => ({ task: "test/user", payload: event }) }],
    enqueue: async () => {
      throw new Error("enqueue unavailable");
    },
  });
  const auth = createAuth(publisher);
  const signup = await auth.api.signUpEmail({ body: input });
  expect((await client.query('SELECT id FROM "user"')).rows).toEqual([{ id: signup.user.id }]);
  expect((await client.query("SELECT user_id FROM account")).rows).toEqual([
    { user_id: signup.user.id },
  ]);
  expect(failure).toHaveBeenCalledWith(
    "business_events.publication.failed",
    expect.objectContaining({
      "everr.business_event.type": "identity.user.created",
      "everr.business_event.failure_stage": "subscriber",
    }),
  );
  failure.mockRestore();
});

it.each(["update", "delete"] as const)(
  "revalidates an email predicate before %s after the lifecycle lock",
  async (operation) => {
    await client.exec(
      `INSERT INTO "user"(id,name,email,email_verified) VALUES ('original','Original','old@example.test',false)`,
    );
    const { facts, events } = capture();
    let moved = false;
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "email-race-regression-secret-long-enough",
      database: identityLifecycleAdapter(
        database,
        (executor) => drizzleAdapter(executor, { provider: "pg" }),
        events,
        {
          withIdentityRequest: (run) => run(),
          async lockUserLifecycle() {
            if (moved) return;
            moved = true;
            // Install the committed state that can appear while waiting for the lock.
            await database
              .update(user)
              .set({ email: "new@example.test" })
              .where(eq(user.id, "original"));
            await database.insert(user).values({
              id: "replacement",
              name: "Replacement",
              email: "old@example.test",
              emailVerified: false,
            });
          },
        },
      ),
    });
    const { adapter } = await auth.$context;
    const target = { model: "user", where: [{ field: "email", value: "old@example.test" }] };
    const result =
      operation === "update"
        ? await adapter.update({ ...target, update: { emailVerified: true } })
        : await adapter.delete(target);
    expect(result ?? null).toBeNull();
    expect((await client.query('SELECT id,email_verified FROM "user" ORDER BY id')).rows).toEqual([
      { id: "original", email_verified: false },
      { id: "replacement", email_verified: false },
    ]);
    expect(facts).toEqual([]);
  },
);
