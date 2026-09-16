import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { member, organization, user } from "@/db/schema";
import { getPolarCustomerForOrg, polarClient } from "@/lib/polar.server";

type BillingPerson = { id: string; email: string; name: string };

export async function readBillingPerson(
  userId: string,
): Promise<BillingPerson> {
  const [person] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!person) throw new Error("Organization owner not found");
  return person;
}

export async function readOrganizationBillingOwner(orgId: string) {
  const members = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: member.role,
      organizationName: organization.name,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.organizationId, orgId));
  const owners = members.filter((person) =>
    person.role.split(",").includes("owner"),
  );
  if (owners.length !== 1)
    throw new Error("Billing requires exactly one organization owner");
  return owners[0];
}

// Called only after Everr has authorized billing access. Email identifies a
// person inside this customer, never the customer itself.
export async function ensurePolarBillingMember(
  customerId: string,
  person: BillingPerson,
  role: "owner" | "billing_manager",
  legacyOwnerExternalId?: string,
) {
  const pages = await polarClient.members.listMembers({
    customerId,
    limit: 100,
  });
  let existing:
    | Awaited<ReturnType<typeof polarClient.members.createMember>>
    | undefined;
  for await (const page of pages) {
    for (const candidate of page.result.items) {
      if (
        candidate.externalId === person.id ||
        candidate.email.toLowerCase() === person.email.toLowerCase()
      ) {
        if (
          candidate.externalId &&
          candidate.externalId !== person.id &&
          !(
            candidate.role === "owner" &&
            candidate.externalId === legacyOwnerExternalId
          )
        )
          throw new Error("Billing member identity does not match this user");
        if (candidate.email.toLowerCase() !== person.email.toLowerCase())
          throw new Error(
            "Billing member email has changed. Contact support to update it.",
          );
        existing = candidate;
      }
    }
  }
  const billingMember =
    existing ??
    (await polarClient.members.createMember({
      customerId,
      externalId: person.id,
      email: person.email,
      name: person.name,
      role: "billing_manager",
    }));
  if (billingMember.customerId !== customerId)
    throw new Error("Billing member belongs to another customer");
  if (
    billingMember.role !== role &&
    !(role === "billing_manager" && billingMember.role === "owner")
  ) {
    return polarClient.members.updateMember({
      id: billingMember.id,
      memberUpdate: { role },
    });
  }
  return billingMember;
}

export async function ensurePolarTeamCustomer(input: {
  orgId: string;
  name: string;
  owner: BillingPerson;
}) {
  let customer = await getPolarCustomerForOrg(input.orgId);
  if (!customer) {
    try {
      customer = await polarClient.customers.create({
        type: "team",
        externalId: input.orgId,
        name: input.name,
        owner: {
          email: input.owner.email,
          name: input.owner.name,
          externalId: input.owner.id,
        },
      });
    } catch (error) {
      // External IDs are unique in Polar. Recover concurrent creation or a lost
      // response by identity, never by email. An unavailable lookup must fail.
      customer = await getPolarCustomerForOrg(input.orgId);
      if (!customer) throw error;
    }
  }
  if (customer.externalId !== input.orgId)
    throw new Error("Billing customer belongs to another organization");
  if (customer.type !== "team") {
    customer = await polarClient.customers.update({
      id: customer.id,
      customerUpdate: { type: "team" },
    });
  }
  await ensurePolarBillingMember(
    customer.id,
    input.owner,
    "owner",
    input.orgId,
  );
  return customer;
}

export async function ensureOrganizationTeamCustomer(orgId: string) {
  const owner = await readOrganizationBillingOwner(orgId);
  return ensurePolarTeamCustomer({
    orgId,
    name: owner.organizationName,
    owner,
  });
}
