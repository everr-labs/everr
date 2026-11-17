import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { describe, expect, it } from "vite-plus/test";
import { apiKeyServerOnlyWritesPlugin } from "./api-key-writes";

const BASE = "http://localhost:3000";

async function setup() {
  const tables = {
    user: [],
    account: [],
    session: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
    apikey: [] as { id: string; key: string; configId: string }[],
  };
  const keyConfig = {
    references: "organization" as const,
    defaultPrefix: "ek_",
    enableMetadata: true,
    rateLimit: { enabled: false },
  };
  const auth = betterAuth({
    baseURL: BASE,
    secret: "api-key-writes-test-secret-with-32-chars",
    database: memoryAdapter(tables),
    emailAndPassword: { enabled: true },
    plugins: [
      organization(),
      apiKey([
        { configId: "ingest", ...keyConfig },
        { configId: "public", ...keyConfig, disableKeyHashing: true },
      ]),
      apiKeyServerOnlyWritesPlugin(),
    ],
  });
  const signedIn = await auth.api.signUpEmail({
    body: { name: "Owner", email: "owner@example.test", password: "writes-test-password" },
    asResponse: true,
  });
  const cookie = signedIn.headers.get("set-cookie") ?? "";
  const org = await auth.api.createOrganization({
    headers: new Headers({ cookie }),
    body: { name: "Writes", slug: "writes" },
  });
  const userId = (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id;
  if (!org || !userId) throw new Error("setup failed");

  const post = (path: string, body: unknown) =>
    auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const createOnServer = (configId: string) =>
    auth.api.createApiKey({
      body: { configId, name: configId, organizationId: org.id, userId },
    });
  return { auth, tables, org, post, createOnServer };
}

describe("apiKeyServerOnlyWritesPlugin", () => {
  it("blocks API key create and update over HTTP, however the path is spelled", async () => {
    const { org, post, createOnServer } = await setup();
    const created = await createOnServer("public");

    expect(
      (await post("/api-key/create", { configId: "public", organizationId: org.id, name: "x" }))
        .status,
    ).toBe(404);
    for (const path of ["/api-key/update", "/api-key/update/", "//api-key/update"]) {
      const res = await post(path, {
        configId: "public",
        keyId: created.id,
        metadata: { public: false },
      });
      expect(res.status, path).toBe(404);
    }
  });
});

describe("unhashed public key config", () => {
  it("stores public keys in plaintext and never matches a hashed key's stored value", async () => {
    const { auth, tables, createOnServer } = await setup();
    const publicKey = await createOnServer("public");
    const secretKey = await createOnServer("ingest");

    expect(tables.apikey.find((row) => row.id === publicKey.id)?.key).toBe(publicKey.key);
    const storedHash = tables.apikey.find((row) => row.id === secretKey.id)?.key ?? "";
    expect(storedHash).not.toBe(secretKey.key);

    const verify = (key: string, configId: string) =>
      auth.api.verifyApiKey({ body: { key, configId } });
    expect((await verify(publicKey.key, "public")).valid).toBe(true);
    expect((await verify(secretKey.key, "ingest")).valid).toBe(true);
    expect((await verify(storedHash, "public")).valid).toBe(false);
    expect((await verify(publicKey.key, "ingest")).valid).toBe(false);
  });
});
