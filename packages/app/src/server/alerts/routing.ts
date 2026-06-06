import { pool } from "@/db/client";

type RecipientRow = {
  userId: string;
};

const BUILT_IN_ROUTING_LISTS = new Set(["everyone", "admins", "owners"]);

export async function resolveRoutingRecipients(input: {
  organizationId: string;
  slug: string;
}): Promise<string[]> {
  const result = await pool.query<RecipientRow>(
    routingSql(input.slug),
    routingValues(input),
  );

  return [...new Set(result.rows.map((row) => row.userId))];
}

export async function routingListExists(input: {
  organizationId: string;
  slug: string;
}): Promise<boolean> {
  if (BUILT_IN_ROUTING_LISTS.has(input.slug)) {
    return true;
  }

  const result = await pool.query(
    `
      SELECT 1
      FROM alert_routing_lists
      WHERE organization_id = $1
        AND slug = $2
      LIMIT 1
    `,
    [input.organizationId, input.slug],
  );

  return result.rows.length > 0;
}

function routingSql(slug: string): string {
  switch (slug) {
    case "everyone":
      return `
        SELECT user_id AS "userId"
        FROM member
        WHERE organization_id = $1
        ORDER BY user_id ASC
      `;
    case "admins":
      return `
        SELECT user_id AS "userId"
        FROM member
        WHERE organization_id = $1
          AND role IN ('admin', 'owner')
        ORDER BY user_id ASC
      `;
    case "owners":
      return `
        SELECT user_id AS "userId"
        FROM member
        WHERE organization_id = $1
          AND role = 'owner'
        ORDER BY user_id ASC
      `;
    default:
      return `
        SELECT m.user_id AS "userId"
        FROM alert_routing_lists l
        JOIN alert_routing_list_members m
          ON m.routing_list_id = l.id
        WHERE l.organization_id = $1
          AND l.slug = $2
        ORDER BY m.user_id ASC
      `;
  }
}

function routingValues(input: {
  organizationId: string;
  slug: string;
}): unknown[] {
  return BUILT_IN_ROUTING_LISTS.has(input.slug)
    ? [input.organizationId]
    : [input.organizationId, input.slug];
}
