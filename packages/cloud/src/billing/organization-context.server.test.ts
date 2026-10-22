// @vitest-environment node
import { betterAuth, generateId } from "better-auth";
import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { expect, it, vi } from "vitest";
import {
  beforeCreateCheckoutOrganization,
  withOrganizationCreationId,
} from "./organization-context.server";

it("preserves the reserved ID through real Better Auth creation and its membership/provisioning hooks", async () => {
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
  };
  const provision = vi.fn();
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "checkout-organization-integration-secret",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        creatorRole: "owner",
        organizationHooks: {
          beforeCreateOrganization: beforeCreateCheckoutOrganization,
          afterCreateOrganization: async ({ organization }) => {
            provision(organization.id);
          },
        },
      }),
    ],
  });
  const { user } = await auth.api.signUpEmail({
    body: {
      email: "owner@example.com",
      name: "Owner",
      password: "password-12345",
    },
  });
  const reservedId = generateId();
  const created = await withOrganizationCreationId(
    { id: reservedId, ownerId: user.id, slug: "acme" },
    () =>
      auth.api.createOrganization({
        body: { name: "Acme", slug: "acme", userId: user.id },
      }),
  );
  expect(created?.id).toBe(reservedId);
  expect(db.member).toEqual([
    expect.objectContaining({
      organizationId: reservedId,
      userId: user.id,
      role: "owner",
    }),
  ]);
  expect(provision).toHaveBeenCalledWith(reservedId);
  const other = await auth.api.createOrganization({
    body: { name: "Other", slug: "other", userId: user.id },
  });
  expect(other?.id).not.toBe(reservedId);
  expect(created?.id).toMatch(/^[a-zA-Z0-9]{32}$/);
  expect(other?.id).toMatch(/^[a-zA-Z0-9]{32}$/);
  await expect(
    withOrganizationCreationId(
      { id: "forged", ownerId: "other", slug: "bad" },
      () =>
        auth.api.createOrganization({
          body: { name: "Bad", slug: "bad", userId: user.id },
        }),
    ),
  ).rejects.toThrow("context mismatch");
});
