// @vitest-environment node
import type { Database, DbExecutor, Transaction } from "@everr/app/db/client";
import { user } from "@everr/app/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { betterAuth } from "better-auth";
import { PgTransaction } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { userTerms } from "../db/schema/legal";
import { organizationLifecycleAdapter } from "../organization-provisioning/adapter.server";
import { cloudTestMigrations } from "../testing/migrations";
import { signupTermsPlugin, withSignupTerms } from "./signup.server";

vi.mock("@everr/app/db/client", () => ({
  db: undefined,
  runInTransaction: <T>(executor: DbExecutor, run: (tx: Transaction) => Promise<T>) =>
    executor instanceof PgTransaction ? run(executor) : executor.transaction(run),
}));

const hash = "a".repeat(64);
const baseURL = "http://localhost:3000";
let fixture: TestDatabase;
let auth: ReturnType<typeof createAuth>;

function createAuth(expectedHash = hash) {
  return betterAuth({
    baseURL,
    secret: "signup-terms-integration-test-secret-long-enough",
    database: organizationLifecycleAdapter(fixture.db as unknown as Database),
    emailAndPassword: { enabled: true },
    socialProviders: {
      google: {
        clientId: "test-google-client",
        clientSecret: "test-google-secret",
      },
    },
    plugins: [signupTermsPlugin(expectedHash)],
    logger: { disabled: true },
  });
}

beforeAll(async () => {
  fixture = await createTestDatabase(cloudTestMigrations);
});
beforeEach(async () => {
  await fixture.truncate();
  auth = createAuth();
});
afterAll(async () => fixture?.close());

function request(path: string, body?: Record<string, unknown>, headers?: Record<string, string>) {
  return withSignupTerms(() =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin: baseURL,
          ...(body ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    ),
  );
}
const emailSignup = (acceptedHash?: string) =>
  request("/sign-up/email", {
    name: "Test user",
    email: "person@example.com",
    password: "long-test-password",
    termsHash: acceptedHash,
  });

it("stores the exact accepted hash with a new email account", async () => {
  expect((await emailSignup(hash)).status).toBe(200);
  const [account] = await fixture.db.select().from(user);
  expect(account.createdAt).toBeInstanceOf(Date);
  expect(await fixture.db.select().from(userTerms)).toEqual([
    { userId: account.id, termsHash: hash },
  ]);
});

it.each([undefined, "b".repeat(64)])(
  "rejects missing or stale email acceptance (%s)",
  async (acceptedHash) => {
    const response = await emailSignup(acceptedHash);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "TERMS_ACCEPTANCE_REQUIRED",
    });
    expect(await fixture.db.select().from(user)).toEqual([]);
  },
);

it("does not invent or replace initial acceptance on subsequent sign-in", async () => {
  await emailSignup(hash);
  auth = createAuth("b".repeat(64));
  expect(
    (
      await request("/sign-in/email", {
        email: "person@example.com",
        password: "long-test-password",
      })
    ).status,
  ).toBe(200);
  expect((await fixture.db.select().from(userTerms))[0].termsHash).toBe(hash);
});

it("rolls back account creation when the acceptance record cannot be saved", async () => {
  await fixture.client.exec(`CREATE FUNCTION reject_terms() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'terms unavailable'; END $$;
    CREATE TRIGGER reject_terms BEFORE INSERT ON user_terms FOR EACH ROW EXECUTE FUNCTION reject_terms()`);
  try {
    expect((await emailSignup(hash)).status).toBe(422);
    expect(await fixture.db.select().from(user)).toEqual([]);
  } finally {
    await fixture.client.exec(
      "DROP TRIGGER reject_terms ON user_terms; DROP FUNCTION reject_terms()",
    );
  }
});

async function googleSignup(acceptedHash?: string, callbackHash?: string) {
  const context = await auth.$context;
  const provider = context.socialProviders[0];
  provider.validateAuthorizationCode = vi.fn().mockResolvedValue({ accessToken: "test-token" });
  provider.getUserInfo = vi.fn().mockResolvedValue({
    data: { sub: "google-test-user" },
    user: {
      id: "google-test-user",
      name: "Google user",
      email: "google@example.com",
      emailVerified: true,
    },
  });
  const start = await request("/sign-in/social", {
    provider: "google",
    callbackURL: "/",
    errorCallbackURL: "/auth/sign-up",
    additionalData: acceptedHash ? { termsHash: acceptedHash } : undefined,
  });
  const { url } = await start.json();
  const state = new URL(url).searchParams.get("state");
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return request(
    `/callback/google?code=test-code&state=${state}&termsHash=${callbackHash ?? ""}`,
    undefined,
    { cookie },
  );
}

it("binds Google account creation to acceptance carried through OAuth state", async () => {
  const response = await googleSignup(hash);
  expect(response.status).toBe(302);
  expect(new URL(response.headers.get("location") ?? "", baseURL).pathname).toBe("/");
  const [account] = await fixture.db.select().from(user);
  expect(account.email).toBe("google@example.com");
  expect(await fixture.db.select().from(userTerms)).toEqual([
    { userId: account.id, termsHash: hash },
  ]);
});

it("allows an existing Google user to sign in without accepting revised Terms at login", async () => {
  await googleSignup(hash);
  auth = createAuth("b".repeat(64));
  const response = await googleSignup();
  expect(new URL(response.headers.get("location") ?? "", baseURL).pathname).toBe("/");
  expect(await fixture.db.select().from(user)).toHaveLength(1);
  expect((await fixture.db.select().from(userTerms))[0].termsHash).toBe(hash);
});

it.each([undefined, "b".repeat(64)])(
  "rejects Google creation without current acceptance in OAuth state (%s)",
  async (acceptedHash) => {
    await googleSignup(acceptedHash, hash);
    expect(await fixture.db.select().from(user)).toEqual([]);
    expect(await fixture.db.select().from(userTerms)).toEqual([]);
  },
);

it("does not leak acceptance from a previous identity request", async () => {
  await emailSignup(hash);
  const response = await request("/sign-up/email", {
    name: "Other user",
    email: "other@example.com",
    password: "long-test-password",
  });
  expect(response.status).toBe(400);
  expect(await fixture.db.select().from(user)).toHaveLength(1);
});
