// Cloud gives each organization its own ClickHouse user for the SQL API, and
// one row policy per readable table that pins the tenant id in as a constant.
// Provisioning writes them for a new organization. A migration seed writes
// the policy of a new table for the organizations that already exist. Both
// build the names and the statement here, so they cannot drift apart.

export const SQL_API_ORG_USER_PREFIX = "sql_api_org_";

// The id goes into DDL: into the user name inside backticks, and into the row
// policy's string literal. better-auth generates it today, so it is not
// caller-chosen. This keeps it that way rather than trusting that it stays true.
const ORG_ID = /^[A-Za-z0-9_-]+$/;

export function isSqlApiOrgId(value: string): boolean {
  return ORG_ID.test(value);
}

export function sqlApiOrgUserName(organizationId: string): string {
  return `${SQL_API_ORG_USER_PREFIX}${organizationId}`;
}

/** The organization a ClickHouse user belongs to, when provisioning made it. */
export function sqlApiOrgIdFromUserName(userName: string): string | undefined {
  if (!userName.startsWith(SQL_API_ORG_USER_PREFIX)) return undefined;
  const organizationId = userName.slice(SQL_API_ORG_USER_PREFIX.length);
  return isSqlApiOrgId(organizationId) ? organizationId : undefined;
}

export function sqlApiOrgPolicyName(organizationId: string, table: string): string {
  return `${sqlApiOrgUserName(organizationId)}_${table}`;
}

/** The statement that lets one organization's user read its own rows of a table. */
export function createSqlApiOrgPolicy(organizationId: string, table: string): string {
  if (!isSqlApiOrgId(organizationId)) {
    throw new Error("organization id is not safe to interpolate into DDL");
  }
  const username = sqlApiOrgUserName(organizationId);
  const policy = sqlApiOrgPolicyName(organizationId, table);
  return `CREATE ROW POLICY IF NOT EXISTS \`${policy}\` ON app.\`${table}\` FOR SELECT USING tenant_id = '${organizationId}' TO \`${username}\``;
}
