// @vitest-environment node
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";
import type { BusinessEvents } from "#app/composition/business-events.ts";
import { createBusinessEventPublisher } from "#app/server/business-events/publisher.ts";
import { businessEventSubscriber } from "#app/server/business-events/subscriber.ts";
import { userEventDefinitions, type UserFact } from "./events";
import { createAuthTestDatabase } from "./testing/database";
import { userLifecycleAdapter } from "./user-adapter";

const { client, database } = await createAuthTestDatabase(
  process.env.EVERR_IDENTITY_TEST_DATABASE_URL,
);
afterAll(() => client.close());
beforeEach(async () => {
  await client.exec('TRUNCATE "user", account, session, verification CASCADE');
});
const input = { name: "Person", email: "person@example.test", password: "long-test-password" };
function createAuth(
  events: BusinessEvents<UserFact>,
  extra: Parameters<typeof betterAuth>[0] = {},
) {
  return betterAuth({
    baseURL: "http://localhost:3000",
    secret: "user-event-integration-secret-long-enough",
    emailAndPassword: { enabled: true },
    user: { deleteUser: { enabled: true } },
    ...extra,
    database: userLifecycleAdapter(
      database,
      (executor) => drizzleAdapter(executor, { provider: "pg" }),
      events,
    ),
  });
}
function capture() {
  const facts: UserFact[] = [];
  return {
    facts,
    events: {
      publish: (fact: UserFact) => {
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
  const failure = vi.fn();
  const definition = userEventDefinitions[0];
  const publisher = createBusinessEventPublisher({
    definitions: userEventDefinitions,
    subscribers: [
      businessEventSubscriber(definition, {
        id: "user-test",
        enqueue: async () => {
          throw new Error("enqueue unavailable");
        },
      }),
    ],
    diagnostics: { log: failure, count() {} },
  });
  const auth = createAuth(publisher);
  const signup = await auth.api.signUpEmail({ body: input });
  await publisher.stop();
  expect((await client.query('SELECT id FROM "user"')).rows).toEqual([{ id: signup.user.id }]);
  expect((await client.query("SELECT user_id FROM account")).rows).toEqual([
    { user_id: signup.user.id },
  ]);
  expect(failure).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: "identity.user.created", stage: "subscriber" }),
  );
});

it("protects committed signup from a misbehaving injected publisher", async () => {
  const auth = createAuth({
    publish() {
      throw new Error("publisher broken");
    },
  });
  const signup = await auth.api.signUpEmail({ body: input });
  expect((await client.query('SELECT id FROM "user"')).rows).toEqual([{ id: signup.user.id }]);
});
