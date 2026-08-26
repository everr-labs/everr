import type { BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { describe, expect, it } from "vitest";

// The service account plugin turns a bearer token into a session without a
// session row. That only works if server-side getSession runs plugin hooks.
function probePlugin(): BetterAuthPlugin {
  return {
    id: "probe",
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.headers?.get("authorization") === "Bearer probe-token",
          handler: createAuthMiddleware(async (ctx) => {
            const session = {
              user: {
                id: "probe-user",
                name: "Probe",
                email: "probe@svc.everr.invalid",
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              session: {
                id: "probe-session",
                token: "probe-token",
                userId: "probe-user",
                createdAt: new Date(),
                updatedAt: new Date(),
                expiresAt: new Date(Date.now() + 3600 * 1000),
              },
            };
            ctx.context.session = session as never;
            if (ctx.path === "/get-session") return session;
            return { context: ctx };
          }),
        },
      ],
    },
  };
}

describe("server-side getSession", () => {
  it("runs plugin before-hooks, so a plugin can supply a session", async () => {
    const auth = betterAuth({
      baseURL: "http://localhost",
      secret: "probe-secret-probe-secret-probe-secret",
      plugins: [probePlugin()],
    });

    const result = await auth.api.getSession({
      headers: new Headers({ authorization: "Bearer probe-token" }),
    });

    expect(result?.user.id).toBe("probe-user");
  });
});
