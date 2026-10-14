// @vitest-environment node

import { authPlugins } from "@app/auth";
import { appEnv } from "@app/env";
import { initialOrganizationFields } from "@app/organization-fields";
import { productPolicy } from "@app/policy";
import { beforeEach, expect, it, vi } from "vitest";
import { createOrganization } from "@/data/organizations";
import { auth } from "@/lib/auth.server";
import { assertCanInviteMembers } from "@/product/membership.server";

vi.mock("@polar-sh/sdk", () => {
  throw new Error("Self-hosting loaded Polar");
});
vi.mock("@/cloud/billing-data.server", () => {
  throw new Error("Self-hosting read subscription state");
});

beforeEach(() => vi.clearAllMocks());

it("has no payment configuration or billing auth plugins", () => {
  expect(Object.keys(appEnv).some((key) => key.startsWith("POLAR_"))).toBe(
    false,
  );
  expect(authPlugins(async () => undefined)).toEqual([]);
  expect(initialOrganizationFields).toEqual({ plan: "self-hosted" });
});

it("permits collaboration independently of subscription state", async () => {
  expect(await productPolicy.forOrganization("org")).toMatchObject({
    access: "enabled",
    canInviteMembers: true,
    retention: { tracesDays: 30, logsDays: 30, metricsDays: 30 },
  });
  await expect(assertCanInviteMembers("org")).resolves.toBeUndefined();
});

it("creates organizations directly with the authenticated owner and no plan selection", async () => {
  vi.mocked(auth.api.createOrganization).mockResolvedValue({
    id: "new-org",
    name: "Acme",
  } as never);
  await expect(
    createOrganization({ data: { organizationName: "Acme" } }),
  ).resolves.toEqual({
    kind: "created",
    organization: { id: "new-org", name: "Acme" },
  });
  expect(auth.api.createOrganization).toHaveBeenCalledWith({
    body: {
      name: "Acme",
      slug: expect.any(String),
      userId: "test_user",
      plan: "self-hosted",
    },
  });
});

it("rejects attempts to select a commercial plan", async () => {
  await expect(
    createOrganization({ data: { organizationName: "Acme", plan: "pro" } }),
  ).rejects.toThrow("Plans are unavailable");
  expect(auth.api.createOrganization).not.toHaveBeenCalled();
});

it("keeps authentication required for organization creation", async () => {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
  await expect(
    createOrganization({ data: { organizationName: "Acme" } }),
  ).rejects.toThrow("Unauthenticated");
});
