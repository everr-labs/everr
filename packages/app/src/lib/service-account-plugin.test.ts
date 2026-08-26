import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateToken } from "./service-account-credentials";

const findToken = vi.fn();
const deleteToken = vi.fn();

vi.mock("./service-account-store", () => ({
  findLiveToken: (...args: unknown[]) => findToken(...args),
  deleteToken: (...args: unknown[]) => deleteToken(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveServiceAccountSession", () => {
  it("returns a session carrying the token's own expiry", async () => {
    const { resolveServiceAccountSession } = await import(
      "./service-account-plugin"
    );
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    findToken.mockResolvedValue({
      expiresAt,
      organizationId: "org-1",
      user: { id: "user-1", name: "Deploy bot", email: "a@svc.everr.invalid" },
    });

    const session = await resolveServiceAccountSession(token.value);

    expect(session?.session.expiresAt).toBe(expiresAt);
    expect(session?.session.activeOrganizationId).toBe("org-1");
    expect(session?.user.id).toBe("user-1");
  });

  it("rejects an expired token and deletes it", async () => {
    const { resolveServiceAccountSession } = await import(
      "./service-account-plugin"
    );
    const token = generateToken();
    findToken.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
      organizationId: "org-1",
      user: { id: "user-1", name: "n", email: "a@svc.everr.invalid" },
      id: "token-1",
    });

    expect(await resolveServiceAccountSession(token.value)).toBeNull();
    expect(deleteToken).toHaveBeenCalledWith("token-1");
  });

  it("ignores anything that is not a service account token", async () => {
    const { resolveServiceAccountSession } = await import(
      "./service-account-plugin"
    );

    expect(await resolveServiceAccountSession("sa_not_a_token")).toBeNull();
    expect(findToken).not.toHaveBeenCalled();
  });
});

describe("serviceAccountPlugin", () => {
  async function callHook(path: string) {
    const { serviceAccountPlugin } = await import("./service-account-plugin");
    const token = generateToken();
    findToken.mockResolvedValue({
      id: "token-1",
      expiresAt: new Date(Date.now() + 3600 * 1000),
      organizationId: "org-1",
      user: { id: "user-1", name: "Deploy bot", email: "a@svc.everr.invalid" },
    });

    const hook = serviceAccountPlugin().hooks?.before?.[0];
    if (!hook) throw new Error("The plugin registered no before-hook.");
    const ctx = {
      path,
      headers: new Headers({ authorization: `Bearer ${token.value}` }),
      context: {} as { session?: { user: { id: string } } },
    };
    return { ctx, result: await hook.handler(ctx as never) };
  }

  it("refuses to let a service account leave its organization", async () => {
    // Leaving deletes the member row with no organization hook in the way,
    // which would strand the account's secrets and tokens.
    await expect(callHook("/organization/leave")).rejects.toThrow(/leave/i);
  });

  it("answers /get-session with the session itself", async () => {
    const { result } = await callHook("/get-session");

    expect(result).toMatchObject({ user: { id: "user-1" } });
  });

  it("hands every other endpoint on to run with the session in context", async () => {
    // The endpoint still has to run: the hook only supplies the caller it
    // runs as. Returning the session here instead would answer every
    // endpoint with a session payload.
    const { ctx, result } = await callHook("/organization/list");

    expect(ctx.context.session).toMatchObject({ user: { id: "user-1" } });
    expect(result).toMatchObject({
      context: { path: "/organization/list" },
    });
    // Answering with the session here, as /get-session does, would hand
    // every endpoint a session payload instead of running it.
    expect(result).not.toHaveProperty("user");
  });
});
