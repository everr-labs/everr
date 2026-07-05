// @vitest-environment node
import { betterAuth } from "better-auth";
import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { deviceAuthorization, organization } from "better-auth/plugins";
import { describe, expect, it } from "vite-plus/test";
import {
  cliDeviceOrganizationPlugin,
  getCapturedDeviceOrganizationId,
  runWithDeviceOrgCapture,
} from "@/lib/cli-device-organization";

// Drives a real device-authorization flow through the installed better-auth
// (memory adapter) and asserts the approval-time org lands on the created
// session. This is the loud guard for the whole carry mechanism: better-auth
// consumes (deletes) the device-code row before creating the session, so if a
// future version breaks the before-hook ordering or the async-context
// continuity our AsyncLocalStorage relies on, these tests fail instead of
// login silently falling back to another org.

const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const CLIENT_ID = "everr-cli-test";

function makeTestAuth() {
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
    deviceCode: [],
  };

  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "cli-device-organization-test-secret",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      // schema is declared non-optional in the plugin's options schema, so an
      // empty object is required (same as production).
      deviceAuthorization({ schema: {} }),
      organization(),
      cliDeviceOrganizationPlugin(),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            // Mirrors the marked-device-org branch of the production
            // session.create.before hook (auth.server.ts).
            data: {
              ...session,
              activeOrganizationId: getCapturedDeviceOrganizationId(),
            },
          }),
        },
      },
    },
  });

  return { auth, db };
}

async function signUpWithHeaders(auth: ReturnType<typeof makeTestAuth>["auth"]) {
  const signUp = await auth.api.signUpEmail({
    body: {
      email: "cli-user@example.com",
      password: "password-1234",
      name: "CLI User",
    },
    returnHeaders: true,
  });

  const sessionCookie = signUp.headers.get("set-cookie")?.split(";")[0];
  if (!sessionCookie) {
    throw new Error("sign-up did not set a session cookie");
  }

  return new Headers({ cookie: sessionCookie });
}

// Runs device code creation → claim → approval with the given browser
// session, then exchanges the device code for a token inside a capture scope
// (as the auth route handler does) and returns the session it created.
async function runDeviceFlow(
  auth: ReturnType<typeof makeTestAuth>["auth"],
  db: MemoryDB,
  headers: Headers,
  betweenApprovalAndToken?: () => Promise<void>,
) {
  const code = await auth.api.deviceCode({ body: { client_id: CLIENT_ID } });

  // Visiting the verification page claims the code for the signed-in user;
  // approval requires the code to be claimed first.
  await auth.api.deviceVerify({
    query: { user_code: code.user_code },
    headers,
  });
  await auth.api.deviceApprove({
    body: { userCode: code.user_code },
    headers,
  });

  await betweenApprovalAndToken?.();

  const token = await runWithDeviceOrgCapture(() =>
    auth.api.deviceToken({
      body: {
        grant_type: DEVICE_GRANT_TYPE,
        device_code: code.device_code,
        client_id: CLIENT_ID,
      },
    }),
  );

  const cliSession = db.session.find(
    (session) => (session as { token?: string }).token === token.access_token,
  ) as { activeOrganizationId?: string | null } | undefined;

  if (!cliSession) {
    throw new Error("device token exchange did not create a session");
  }

  return cliSession;
}

describe("cli device organization (device flow integration)", () => {
  it("lands the CLI session on the org active at approval time", async () => {
    const { auth, db } = makeTestAuth();
    const headers = await signUpWithHeaders(auth);

    const orgA = await auth.api.createOrganization({
      body: { name: "Org A", slug: "org-a" },
      headers,
    });
    const orgB = await auth.api.createOrganization({
      body: { name: "Org B", slug: "org-b" },
      headers,
    });
    if (!orgA || !orgB) {
      throw new Error("failed to create test organizations");
    }

    await auth.api.setActiveOrganization({
      body: { organizationId: orgA.id },
      headers,
    });

    const cliSession = await runDeviceFlow(auth, db, headers, async () => {
      // Switching orgs after approval must not move the CLI login: the org
      // active at approval wins over a later switch.
      await auth.api.setActiveOrganization({
        body: { organizationId: orgB.id },
        headers,
      });
    });

    expect(cliSession.activeOrganizationId).toBe(orgA.id);
    // The exchange consumed the device-code row — anything reading the marked
    // org after this point would find nothing. This is why the org has to be
    // captured in the /device/token before-hook.
    expect(db.deviceCode).toHaveLength(0);
  });

  it("leaves the session org unset when no org was active at approval", async () => {
    const { auth, db } = makeTestAuth();
    const headers = await signUpWithHeaders(auth);

    const cliSession = await runDeviceFlow(auth, db, headers);

    expect(cliSession.activeOrganizationId ?? null).toBeNull();
  });

  it("returns no captured org outside a capture scope", () => {
    expect(getCapturedDeviceOrganizationId()).toBeNull();
  });
});
