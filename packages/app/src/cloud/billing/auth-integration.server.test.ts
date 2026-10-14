// @vitest-environment node
import { betterAuth } from "better-auth";
import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beforeUserUpdate: vi.fn(),
  afterUserUpdate: vi.fn(),
  beforeMembershipChange: vi.fn(),
  afterMembershipChange: vi.fn(),
}));
vi.mock("./server", () => ({ billing: mocks }));
vi.mock("./lock.server", () => ({
  withBillingRequest: (run: () => Promise<unknown>) => run(),
}));

import { billingIdentityAdapter } from "./auth-adapter.server";
import {
  billingMembershipPlugin,
  billingOrganizationHooks,
} from "./membership-plugin.server";

it("uses the actual update target for authenticated profile and anonymous verified-email changes", async () => {
  vi.clearAllMocks();
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  let verificationUrl = "";
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "billing-auth-integration-secret-long-enough",
    database: billingIdentityAdapter(memoryAdapter(db)),
    emailAndPassword: { enabled: true },
    user: { changeEmail: { enabled: true } },
    emailVerification: {
      sendVerificationEmail: async ({ url }) => {
        verificationUrl = url;
      },
    },
  });
  const response = await auth.api.signUpEmail({
    body: {
      email: "old@example.com",
      name: "Owner",
      password: "password-12345",
    },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: response.headers.get("set-cookie") ?? "",
  });
  const owner = db.user[0];
  owner.emailVerified = true;
  await auth.api.updateUser({ headers, body: { name: "Renamed" } });
  expect(mocks.beforeUserUpdate).toHaveBeenCalledWith(
    owner.id,
    expect.objectContaining({ name: "Renamed" }),
  );
  await auth.api.changeEmail({
    headers,
    body: { newEmail: "new@example.com" },
  });
  const token = new URL(verificationUrl).searchParams.get("token");
  if (!token) throw new Error("Verification token missing");
  mocks.beforeUserUpdate.mockClear();
  await auth.api.verifyEmail({ query: { token } });
  expect(mocks.beforeUserUpdate).toHaveBeenCalledWith(
    owner.id,
    expect.objectContaining({ email: "new@example.com", emailVerified: true }),
  );
  expect(mocks.afterUserUpdate).toHaveBeenCalledWith(owner.id);
  expect(db.user[0].email).toBe("new@example.com");
});
it("blocks direct Better Auth removal, role changes and voluntary leave when Polar revocation fails", async () => {
  vi.clearAllMocks();
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "billing-auth-integration-secret-long-enough",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      billingMembershipPlugin(mocks),
      organization({ organizationHooks: billingOrganizationHooks(mocks) }),
    ],
  });
  const response = await auth.api.signUpEmail({
    body: {
      email: "owner@example.com",
      name: "Owner",
      password: "password-12345",
    },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: response.headers.get("set-cookie") ?? "",
  });
  const owner = db.user[0];
  const org = await auth.api.createOrganization({
    headers,
    body: { name: "Org", slug: "org" },
  });
  if (!org) throw new Error("Organization missing");
  const second = await auth.api.signUpEmail({
    body: {
      email: "admin@example.com",
      name: "Admin",
      password: "password-12345",
    },
    asResponse: true,
  });
  const admin = db.user.find((u) => u.email === "admin@example.com");
  if (!admin) throw new Error("Admin missing");
  await auth.api.addMember({
    body: { organizationId: org.id, userId: admin.id, role: "admin" },
  });
  const membership = db.member.find((m) => m.userId === admin.id);
  if (!membership) throw new Error("Membership missing");
  mocks.beforeMembershipChange.mockRejectedValue(
    new Error("Polar unavailable"),
  );
  await expect(
    auth.api.removeMember({
      headers,
      body: { organizationId: org.id, memberIdOrEmail: membership.id },
    }),
  ).rejects.toThrow("Polar unavailable");
  await expect(
    auth.api.updateMemberRole({
      headers,
      body: { organizationId: org.id, memberId: membership.id, role: "member" },
    }),
  ).rejects.toThrow("Polar unavailable");
  await expect(
    auth.api.leaveOrganization({
      headers: new Headers({ cookie: second.headers.get("set-cookie") ?? "" }),
      body: { organizationId: org.id },
    }),
  ).rejects.toThrow("Polar unavailable");
  expect(db.member.find((m) => m.userId === admin.id)?.role).toBe("admin");
  expect(db.member.some((m) => m.userId === owner.id)).toBe(true);
  mocks.beforeMembershipChange.mockReset();
});

it("exposes the organization's customer reference but rejects client reassignment", async () => {
  const { organizationBillingFields } = await import(
    "@/common/organization-billing-fields"
  );
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "billing-auth-integration-secret-long-enough",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        schema: {
          organization: { additionalFields: organizationBillingFields },
        },
      }),
    ],
  });
  const response = await auth.api.signUpEmail({
    body: {
      email: "owner@example.com",
      name: "Owner",
      password: "password-12345",
    },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: response.headers.get("set-cookie") ?? "",
  });
  const org = await auth.api.createOrganization({
    headers,
    body: { name: "Org", slug: "org" },
  });
  if (!org) throw new Error("Organization missing");
  expect(db.organization[0].polarCustomerId).toBeUndefined();
  // Only the billing server writes the verified reference to persistence.
  db.organization[0].polarCustomerId = "verified-customer";
  const update = await auth.handler(
    new Request("http://localhost:3000/api/auth/organization/update", {
      method: "POST",
      headers: {
        cookie: headers.get("cookie") ?? "",
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        organizationId: org.id,
        data: { name: "Renamed", polarCustomerId: "foreign-customer" },
      }),
    }),
  );
  expect([200, 400]).toContain(update.status);
  expect(db.organization[0].polarCustomerId).toBe("verified-customer");
  const read = await auth.api.getFullOrganization({
    headers,
    query: { organizationId: org.id },
  });
  expect(read?.polarCustomerId).toBe("verified-customer");
});
