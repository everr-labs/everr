import { randomUUID } from "node:crypto";
import { runSqlApiQuery } from "@everr/app/lib/clickhouse";
import { type AdminCommandOptions, adminCommand } from "@everr/app/lib/clickhouse-writer";
import { SQL_API_TABLES } from "@everr/app/lib/sql-api-tables";
import { sqlApiOrgPassword, sqlApiOrgUserName } from "./credentials";

// Every provisioning statement interpolates the organization id into DDL: the
// username inside backticks, and the tenant id inside the row policy's string
// literal. better-auth generates the id today, so it is not caller-chosen,
// and this keeps it that way rather than trusting that it stays true.
function assertSqlApiOrgId(organizationId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(organizationId)) {
    throw new Error("organization id is not safe to interpolate into DDL");
  }
}

function sqlApiOrgPolicyName(organizationId: string, table: string): string {
  return `${sqlApiOrgUserName(organizationId)}_${table}`;
}

// Create the per-org ClickHouse user, set its profile + default role, grant
// sql_api_role, and create the per-table row policies that pin the tenant id
// in as a constant.
export async function provisionSqlApiOrgUser(
  organizationId: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  assertSqlApiOrgId(organizationId);
  const username = sqlApiOrgUserName(organizationId);
  const password = sqlApiOrgPassword(organizationId);
  const tenantLiteral = `'${organizationId}'`;
  const command = (sql: string, options: AdminCommandOptions = {}) =>
    adminCommand(sql, {
      ...options,
      ...(abortSignal ? { abort_signal: abortSignal } : {}),
    });

  await command(
    `CREATE USER IF NOT EXISTS \`${username}\` IDENTIFIED WITH sha256_password BY '${password}' SETTINGS PROFILE 'sql_api_profile'`,
  );
  // CH 26 requires sql_api_role to be active for WITH ADMIN OPTION to work,
  // but DEFAULT ROLE NONE keeps it off to avoid the readonly profile. Activate
  // it in an ephemeral session scoped to just these two statements.
  const sessionId = randomUUID();
  await command("SET ROLE sql_api_role", {
    clickhouse_settings: { session_id: sessionId },
  });
  await command(`GRANT sql_api_role TO \`${username}\``, {
    clickhouse_settings: { session_id: sessionId },
  });
  // DEFAULT ROLE has to come after the GRANT — CH validates the role is
  // already granted to the user before it can be the default.
  await command(`ALTER USER \`${username}\` DEFAULT ROLE sql_api_role`);

  for (const table of SQL_API_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await command(
      `CREATE ROW POLICY IF NOT EXISTS \`${policy}\` ON app.\`${table}\` FOR SELECT USING tenant_id = ${tenantLiteral} TO \`${username}\``,
    );
  }

  // Authenticate through the same client as user queries before publishing
  // readiness. Request boundaries enforce readiness for user queries.
  const result = await runSqlApiQuery(
    "SELECT 1 FROM app.traces LIMIT 0",
    organizationId,
    undefined,
    "JSONEachRow",
    abortSignal,
  );
  await result.json();
}

// Reverse of provisionSqlApiOrgUser. Order is important: drop the policies
// before the user so DROP USER doesn't fail with "user is referenced".
export async function deprovisionSqlApiOrgUser(
  organizationId: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  assertSqlApiOrgId(organizationId);
  const username = sqlApiOrgUserName(organizationId);

  for (const table of SQL_API_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await adminCommand(
      `DROP ROW POLICY IF EXISTS \`${policy}\` ON app.\`${table}\``,
      abortSignal ? { abort_signal: abortSignal } : {},
    );
  }

  await adminCommand(
    `DROP USER IF EXISTS \`${username}\``,
    abortSignal ? { abort_signal: abortSignal } : {},
  );
}
