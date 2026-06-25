import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organization, user } from "@/db/schema";

export type McpIdentity = {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; slug: string };
};

/** The authenticated user and the org this MCP connection is scoped to. */
export async function getMcpIdentity(
  userId: string,
  organizationId: string,
): Promise<McpIdentity | null> {
  const [u] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  const [org] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (!u || !org) return null;
  return { user: u, organization: org };
}
