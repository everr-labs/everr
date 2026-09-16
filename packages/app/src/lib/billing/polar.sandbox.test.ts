// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { env } from "@/env";
import { createPolarGateway, polarClient } from "./polar.server";

it.skipIf(process.env.EVERR_POLAR_SANDBOX_TEST !== "1")(
  "supports team identity, email updates and revocation of an already issued portal token",
  async () => {
    expect(env.POLAR_SERVER).toBe("sandbox");
    const gateway = createPolarGateway();
    const id = randomUUID();
    const domain = env.EMAIL_FROM.split("@")[1];
    const email = `billing-test-${id}@${domain}`;
    const owner = { id: `owner-${id}`, name: "Billing contract test", email };
    const orgId = `billing-contract-${id}`;
    const created: string[] = [];
    try {
      const customer = await gateway.createTeam({
        orgId,
        name: "Everr billing contract test",
        owner,
      });
      created.push(customer.id);
      const second = await gateway.createTeam({
        orgId: `${orgId}-second`,
        name: "Everr billing contract test",
        owner,
      });
      created.push(second.id);
      expect(customer.type).toBe("team");
      expect(second.id).not.toBe(customer.id);
      const manager = await gateway.createMember(customer.id, {
        id: `manager-${id}`,
        email: `manager-${email}`,
        name: "Manager",
      });
      const changed = await gateway.updateMember(manager.id, {
        email: `changed-${email}`,
        name: "Updated manager",
      });
      expect(changed.email).toBe(`changed-${email}`);
      expect(
        (await gateway.members(customer.id)).find((m) => m.id === manager.id)
          ?.email,
      ).toBe(changed.email);
      await gateway.updateMember(manager.id, { role: "owner" });
      expect(
        (await gateway.members(customer.id)).find((m) => m.role === "owner")
          ?.id,
      ).toBe(manager.id);
      const originalOwner = (await gateway.members(customer.id)).find(
        (m) => m.externalId === owner.id,
      );
      if (!originalOwner) throw new Error("Missing sandbox owner");
      await gateway.updateMember(originalOwner.id, { role: "owner" });
      const session = await polarClient.customerSessions.create({
        customerId: customer.id,
        memberId: manager.id,
      });
      const readPortal = () =>
        fetch("https://sandbox-api.polar.sh/v1/customer-portal/customers/me", {
          headers: { Authorization: `Bearer ${session.token}` },
          signal: AbortSignal.timeout(15000),
        });
      expect((await readPortal()).status).toBe(200);
      await gateway.deleteMember(manager.id);
      expect([401, 403]).toContain((await readPortal()).status);
      const checkout = await gateway.createCheckout({
        customerId: customer.id,
        orgId,
        metadata: { orgId },
        successUrl:
          "http://localhost:5173/checkout/success?checkout_id={CHECKOUT_ID}",
      });
      expect(checkout.customerId).toBe(customer.id);
      expect(checkout.externalCustomerId).toBe(orgId);
      expect(
        (await gateway.checkouts(customer.id)).some(
          (c) => c.id === checkout.id,
        ),
      ).toBe(true);
    } finally {
      for (const customerId of created)
        await polarClient.customers.delete({ id: customerId });
    }
  },
);
