import { beforeEach, describe, expect, it, vi } from "vitest";

const findSecret = vi.fn();
const insertToken = vi.fn();
const touchLastUsed = vi.fn();
const deleteExpiredTokens = vi.fn();
const consumeAllowance = vi.fn();

vi.mock("@/lib/service-account-store", () => ({
  findLiveSecret: (...a: unknown[]) => findSecret(...a),
  insertToken: (...a: unknown[]) => insertToken(...a),
  touchLastUsed: (...a: unknown[]) => touchLastUsed(...a),
  deleteExpiredTokensForSecret: (...a: unknown[]) => deleteExpiredTokens(...a),
  consumeExchangeAllowance: (...a: unknown[]) => consumeAllowance(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  consumeAllowance.mockResolvedValue(true);
});

describe("exchangeSecret", () => {
  it("returns a token that expires in an hour", async () => {
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue({ id: "secret-1" });

    const result = await exchangeSecret("sa_valid");

    if (result.status !== "issued") throw new Error("expected a token");
    expect(result.body.token.startsWith("st_")).toBe(true);
    const ttl = new Date(result.body.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(3500 * 1000);
    expect(ttl).toBeLessThanOrEqual(3600 * 1000);
  });

  it("returns nothing for a secret that is unknown or revoked", async () => {
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue(null);

    expect((await exchangeSecret("sa_revoked")).status).toBe("invalid_secret");
  });

  it("returns nothing when handed a bearer token instead of a secret", async () => {
    const { exchangeSecret } = await import("./token");

    expect((await exchangeSecret("st_something")).status).toBe(
      "invalid_secret",
    );
    expect(findSecret).not.toHaveBeenCalled();
  });

  it("stores only the hash, never the token", async () => {
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue({ id: "secret-1" });

    const result = await exchangeSecret("sa_valid");
    if (result.status !== "issued") throw new Error("expected a token");

    const stored = insertToken.mock.calls.at(-1)?.[0] as { hash: string };
    expect(stored.hash).not.toBe(result.body.token);
  });

  it("stamps last_used_at on the secret and the account on success", async () => {
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue({
      id: "secret-1",
      serviceAccountId: "account-1",
    });

    await exchangeSecret("sa_valid");

    expect(touchLastUsed).toHaveBeenCalledWith("account-1", "secret-1");
  });

  it("does not stamp last_used_at when the secret is rejected", async () => {
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue(null);

    await exchangeSecret("sa_revoked");

    expect(touchLastUsed).not.toHaveBeenCalled();
  });

  it("drops the secret's already expired tokens when it issues a new one", async () => {
    // A token nobody presents again is never looked at, so nothing else
    // would ever delete it and the table would grow with every exchange.
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue({
      id: "secret-1",
      serviceAccountId: "account-1",
    });

    await exchangeSecret("sa_valid");

    expect(deleteExpiredTokens).toHaveBeenCalledWith("secret-1");
  });

  it("drops no tokens when the secret is rejected", async () => {
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue(null);

    await exchangeSecret("sa_revoked");

    expect(deleteExpiredTokens).not.toHaveBeenCalled();
  });

  it("mints no token for a secret that has spent its allowance", async () => {
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue({
      id: "secret-1",
      serviceAccountId: "account-1",
    });
    consumeAllowance.mockResolvedValue(false);

    const result = await exchangeSecret("sa_valid");

    expect(result.status).toBe("rate_limited");
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("counts the allowance on the secret, never on the caller", async () => {
    // Nothing the caller sends can move the count somewhere else.
    const { exchangeSecret } = await import("./token");
    findSecret.mockResolvedValue({ id: "secret-1" });

    await exchangeSecret("sa_valid");

    expect(consumeAllowance.mock.calls.at(-1)?.[0]).toBe("secret-1");
  });
});

type PostHandler = (args: { request: Request }) => Promise<Response>;

async function getHandler(): Promise<PostHandler> {
  const { Route } = await import("./token");
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } };
  };
  const handler = routeOptions.server?.handlers?.POST;
  if (!handler) throw new Error("Missing POST handler for token.");
  return handler;
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/service-accounts/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/service-accounts/token", () => {
  it("issues a token for a live secret", async () => {
    findSecret.mockResolvedValue({ id: "secret-1" });

    const res = await (await getHandler())({
      request: makeRequest({ secret: "sa_valid" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expires_at: string };
    expect(body.token.startsWith("st_")).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a revoked secret and an unknown secret identically", async () => {
    findSecret.mockResolvedValueOnce(null);
    const revoked = await (await getHandler())({
      request: makeRequest({ secret: "sa_revoked" }),
    });

    findSecret.mockResolvedValueOnce(null);
    const unknown = await (await getHandler())({
      request: makeRequest({ secret: "sa_unknown" }),
    });

    expect(revoked.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await revoked.json()).toEqual(await unknown.json());
  });

  it("rejects a body without a string secret", async () => {
    const res = await (await getHandler())({
      request: makeRequest({ secret: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a literal null body", async () => {
    const res = await (await getHandler())({
      request: makeRequest(null),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await (await getHandler())({
      request: new Request("http://localhost/api/service-accounts/token", {
        method: "POST",
        body: "not json",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("answers 429 with an empty body once the secret is over its limit", async () => {
    findSecret.mockResolvedValue({ id: "secret-1" });
    consumeAllowance.mockResolvedValue(false);

    const res = await (await getHandler())({
      request: makeRequest({ secret: "sa_valid" }),
    });

    expect(res.status).toBe(429);
    expect(await res.text()).toBe("");
  });
});
