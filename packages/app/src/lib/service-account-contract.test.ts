import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { organization as organizationPlugin } from "better-auth/plugins";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateToken } from "./service-account-credentials";

// Every refusal this feature relies on is a fact about better-auth 1.7.1
// rather than about our code: which hook names the organization plugin
// calls, where in each endpoint it calls them, that `/organization/leave`
// has no hook at all, and that `/delete-user` re-reads the session from the
// store. Typecheck cannot see any of that, and the guard unit tests call our
// functions directly, so they would all stay green if an upgrade stopped
// calling them. This file drives the real better-auth dispatcher and fails
// when any of those facts stops holding.

const findLiveToken = vi.fn();

vi.mock("./service-account-store", () => ({
  findLiveToken: (...args: unknown[]) => findLiveToken(...args),
  deleteToken: vi.fn(),
}));

// The guards read `user.is_service_account` back from our own database. The
// only user any of them is asked about here is the service account, because
// the human's organizations and memberships are written straight through
// better-auth's adapter, so one fixed answer is the whole of what the user
// table has to supply. Whether the flag itself is read correctly is the
// subject of service-account-member-guards.server.test.ts.
vi.mock("@/db/client", () => {
  // biome-ignore lint/suspicious/noExplicitAny: a query-builder passthrough mock has no fixed shape.
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: async () => [{ isServiceAccount: true }],
  };
  return { db: { select: () => chain } };
});

const HUMAN = { email: "owner@example.com", password: "owner-password-1" };
const SERVICE_ACCOUNT_USER = {
  id: "service-account-user",
  name: "Deploy bot",
  email: "deploy-bot@svc.everr.invalid",
  emailVerified: true,
  image: null,
};

type Fixture = Awaited<ReturnType<typeof buildFixture>>;

async function buildFixture() {
  const { serviceAccountOrganizationHooks } = await import(
    "./service-account-member-guards.server"
  );
  const { serviceAccountPlugin } = await import("./service-account-plugin");

  const auth = betterAuth({
    baseURL: "http://localhost",
    secret: "contract-secret-contract-secret-contract",
    database: memoryAdapter({
      account: [],
      invitation: [],
      member: [],
      organization: [],
      session: [],
      user: [],
      verification: [],
    }),
    emailAndPassword: { enabled: true },
    // Enabled in our own configuration too, which is what makes the
    // `/delete-user` case below worth asserting.
    user: { deleteUser: { enabled: true } },
    plugins: [
      organizationPlugin({
        organizationHooks: { ...serviceAccountOrganizationHooks },
      }),
      serviceAccountPlugin(),
    ],
  });

  const { adapter } = await auth.$context;

  const signUp = await auth.api.signUpEmail({
    body: { ...HUMAN, name: "Owner" },
    returnHeaders: true,
  });
  const humanId = signUp.response.user.id;
  const humanHeaders = new Headers({
    cookie: signUp.headers.get("set-cookie") ?? "",
  });

  // Written through the adapter rather than through `/organization/create`
  // so that no guard runs for the human: every guard invocation in this
  // file is then about the service account.
  async function makeOrganization(id: string) {
    await adapter.create({
      model: "organization",
      data: { id, name: id, slug: id, createdAt: new Date() },
      forceAllowId: true,
    });
    await adapter.create({
      model: "member",
      data: {
        organizationId: id,
        userId: humanId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    return id;
  }

  // The account acts in `home`. `other` is an organization it has nothing to
  // do with, which is where the paths that would give it a second membership
  // have to be tried: better-auth refuses those outright for an existing
  // member, before any hook runs.
  const home = await makeOrganization("home-org");
  const other = await makeOrganization("other-org");

  await adapter.create({
    model: "user",
    data: {
      ...SERVICE_ACCOUNT_USER,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    forceAllowId: true,
  });
  const serviceAccountMember = await adapter.create<{ id: string }>({
    model: "member",
    data: {
      organizationId: home,
      userId: SERVICE_ACCOUNT_USER.id,
      role: "member",
      createdAt: new Date(),
    },
  });

  const token = generateToken();
  findLiveToken.mockResolvedValue({
    id: "token-row",
    expiresAt: new Date(Date.now() + 3600 * 1000),
    organizationId: home,
    user: {
      ...SERVICE_ACCOUNT_USER,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const serviceAccountHeaders = new Headers({
    authorization: `Bearer ${token.value}`,
  });

  return {
    adapter,
    auth,
    home,
    humanHeaders,
    humanId,
    other,
    serviceAccountHeaders,
    serviceAccountMember,
  };
}

let fixture: Fixture;

beforeEach(async () => {
  vi.clearAllMocks();
  fixture = await buildFixture();
});

async function memberCount(userId: string) {
  const rows = await fixture.adapter.findMany({
    model: "member",
    where: [{ field: "userId", value: userId }],
  });
  return rows.length;
}

describe("what better-auth refuses a service account", () => {
  it("refuses to create an organization, before the organization row exists", async () => {
    // The guard has to run on `beforeCreateOrganization`: the organization
    // row is written before the creator's member row, and deleting an
    // organization needs a membership, so a refusal any later leaves a row
    // nobody can ever remove.
    await expect(
      fixture.auth.api.createOrganization({
        headers: fixture.serviceAccountHeaders,
        body: { name: "Agent org", slug: "agent-org" },
      }),
    ).rejects.toThrow(/cannot create an organization/i);

    expect(
      await fixture.adapter.findOne({
        model: "organization",
        where: [{ field: "slug", value: "agent-org" }],
      }),
    ).toBeNull();
  });

  it("refuses to add it to an organization", async () => {
    await expect(
      fixture.auth.api.addMember({
        body: {
          userId: SERVICE_ACCOUNT_USER.id,
          organizationId: fixture.other,
          role: "member",
        },
      }),
    ).rejects.toThrow(/cannot be added to an organization/i);

    expect(await memberCount(SERVICE_ACCOUNT_USER.id)).toBe(1);
  });

  it("refuses to invite it", async () => {
    await expect(
      fixture.auth.api.createInvitation({
        headers: fixture.humanHeaders,
        body: {
          email: SERVICE_ACCOUNT_USER.email,
          role: "member",
          organizationId: fixture.other,
        },
      }),
    ).rejects.toThrow(/cannot invite a service account/i);
  });

  it("refuses to let it accept an invitation", async () => {
    // Written through the adapter because the guard above stops the endpoint
    // from ever creating one. What this asserts is the other end of the
    // flow: an invitation that exists, whichever path wrote it.
    const invitation = await fixture.adapter.create<{ id: string }>({
      model: "invitation",
      data: {
        email: SERVICE_ACCOUNT_USER.email,
        role: "member",
        organizationId: fixture.other,
        inviterId: fixture.humanId,
        status: "pending",
        expiresAt: new Date(Date.now() + 3600 * 1000),
        createdAt: new Date(),
      },
    });

    await expect(
      fixture.auth.api.acceptInvitation({
        headers: fixture.serviceAccountHeaders,
        body: { invitationId: invitation.id },
      }),
    ).rejects.toThrow(/cannot accept an invitation/i);

    expect(await memberCount(SERVICE_ACCOUNT_USER.id)).toBe(1);
  });

  it("refuses to promote it to owner", async () => {
    await expect(
      fixture.auth.api.updateMemberRole({
        headers: fixture.humanHeaders,
        body: {
          memberId: fixture.serviceAccountMember.id,
          organizationId: fixture.home,
          role: "owner",
        },
      }),
    ).rejects.toThrow(/cannot hold the owner role/i);
  });

  it("refuses to remove its membership through the member path", async () => {
    await expect(
      fixture.auth.api.removeMember({
        headers: fixture.humanHeaders,
        body: {
          memberIdOrEmail: fixture.serviceAccountMember.id,
          organizationId: fixture.home,
        },
      }),
    ).rejects.toThrow(/orphan its secrets/i);

    expect(await memberCount(SERVICE_ACCOUNT_USER.id)).toBe(1);
  });

  it("refuses to let it leave its organization", async () => {
    // `/organization/leave` has no hook of any kind, so the plugin refuses
    // the path by name. A renamed path would let the call through, and the
    // member row is what proves it did not.
    await expect(
      fixture.auth.api.leaveOrganization({
        headers: fixture.serviceAccountHeaders,
        body: { organizationId: fixture.home },
      }),
    ).rejects.toThrow(/cannot leave an organization/i);

    expect(await memberCount(SERVICE_ACCOUNT_USER.id)).toBe(1);
  });

  it("refuses `/delete-user`, which nothing in this repository guards", async () => {
    // Closed by better-auth's own `sensitiveSessionMiddleware`: it drops the
    // session the plugin put in context and re-reads it from the session
    // store, where a service account has no row. An upgrade that made it
    // trust the session in context would hand an unattended credential the
    // power to delete its own user.
    // Unauthorized, not one of our messages: the refusal comes from the
    // missing session row, so it stops meaning anything the moment
    // better-auth trusts the session in context.
    await expect(
      fixture.auth.api.deleteUser({
        headers: fixture.serviceAccountHeaders,
        body: {},
      }),
    ).rejects.toThrow(/unauthorized/i);

    expect(
      await fixture.adapter.findOne({
        model: "user",
        where: [{ field: "id", value: SERVICE_ACCOUNT_USER.id }],
      }),
    ).not.toBeNull();
  });
});
