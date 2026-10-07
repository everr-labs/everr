// @vitest-environment node
import { betterAuth } from "better-auth";
import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { expect, it } from "vitest";
import { apiKeyPlugin } from "./api-key-plugin.server";

it("stores public values and secret hashes, isolates verification, and revokes both types", async () => {
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
    apikey: [],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "key-configuration-integration-test-secret",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [organization(), apiKeyPlugin()],
  });
  const {
    headers: signupHeaders,
    response: { user },
  } = await auth.api.signUpEmail({
    returnHeaders: true,
    body: {
      email: "key-owner@example.com",
      name: "Owner",
      password: "test-password-12345",
    },
  });
  const org = await auth.api.createOrganization({
    body: { name: "Keys", slug: "keys", userId: user.id },
  });
  if (!org) throw new Error("Organization creation failed");
  const headers = new Headers({
    cookie: signupHeaders
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; "),
  });
  const base = {
    organizationId: org.id,
    userId: user.id,
    name: "integration",
  };
  const publicKey = await auth.api.createApiKey({
    body: {
      ...base,
      configId: "public",
      metadata: { allowedOrigins: ["https://app.example.com"] },
    },
  });
  const secretKey = await auth.api.createApiKey({
    body: {
      ...base,
      configId: "secret",
      permissions: { ingest: ["write"], apply: ["read"] },
    },
  });
  expect(publicKey.key).toMatch(/^pk_/);
  expect(secretKey.key).toMatch(/^sk_/);
  expect(db.apikey.find((row) => row.id === publicKey.id)?.key).toBe(
    publicKey.key,
  );
  expect(db.apikey.find((row) => row.id === secretKey.id)?.key).not.toBe(
    secretKey.key,
  );
  expect(publicKey.permissions).toEqual({ ingest: ["write"] });
  for (const [key, configId, other] of [
    [publicKey, "public", "secret"],
    [secretKey, "secret", "public"],
  ] as const) {
    expect(
      (await auth.api.verifyApiKey({ body: { key: key.key, configId } })).valid,
    ).toBe(true);
    expect(
      (await auth.api.verifyApiKey({ body: { key: key.key, configId: other } }))
        .valid,
    ).toBe(false);
    const listed = await auth.api.listApiKeys({
      query: { configId, organizationId: org.id },
      headers,
    });
    expect(listed.apiKeys).toEqual([
      expect.objectContaining({ id: key.id, configId }),
    ]);
    expect(listed.apiKeys[0]).not.toHaveProperty("key");
    await auth.api.deleteApiKey({ body: { keyId: key.id, configId }, headers });
    expect(
      (await auth.api.verifyApiKey({ body: { key: key.key, configId } })).valid,
    ).toBe(false);
  }
});
