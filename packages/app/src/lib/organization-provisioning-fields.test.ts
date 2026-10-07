// @vitest-environment node
import { betterAuth } from "better-auth";
import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { expect, it } from "vitest";
import { organizationProvisioningFields } from "@/common/organization-provisioning-fields";

it("starts all new organizations pending and never accepts readiness from clients", async () => {
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
    secret: "organization-provisioning-integration-secret-long-enough",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        schema: {
          organization: { additionalFields: organizationProvisioningFields },
        },
      }),
    ],
  });
  const signup = await auth.api.signUpEmail({
    body: {
      name: "Owner",
      email: "owner@example.com",
      password: "password-12345",
    },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: signup.headers.get("set-cookie") ?? "",
  });
  const created = await auth.api.createOrganization({
    headers,
    body: { name: "New", slug: "new", ...{ clickhouseReady: true } },
  });
  expect(created?.clickhouseReady).toBe(false);
  expect(db.organization[0].clickhouseReady).toBe(false);
  await auth.api.updateOrganization({
    headers,
    body: { data: { name: "Updated", ...{ clickhouseReady: true } } },
  });
  expect(db.organization[0].clickhouseReady).toBe(false);
});
