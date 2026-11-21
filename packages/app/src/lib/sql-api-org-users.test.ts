import { describe, expect, it } from "vite-plus/test";
import { clickHouseMigrations } from "#app/db/clickhouse-sql.ts";
import {
  createSqlApiOrgPolicy,
  sqlApiOrgIdFromUserName,
  sqlApiOrgUserName,
} from "./sql-api-org-users";

describe("SQL API organization users", () => {
  it("reads the organization back from the user name provisioning gives it", () => {
    expect(sqlApiOrgIdFromUserName(sqlApiOrgUserName("org_42-a"))).toBe("org_42-a");
  });

  it.each(["sql_api", "app_ro", "sql_api_org_", "sql_api_org_a'b", "sql_api_org_a b"])(
    "does not take %s for an organization's user",
    (name) => {
      expect(sqlApiOrgIdFromUserName(name)).toBeUndefined();
    },
  );

  it("refuses an organization id that would change the statement", () => {
    expect(() => createSqlApiOrgPolicy("a' OR 1 --", "recordings")).toThrow(
      "organization id is not safe to interpolate into DDL",
    );
  });
});

describe("recordings SQL API policy seed", () => {
  const seed = clickHouseMigrations.find(
    ({ name }) => name === "0016-cloud-recordings-sql-api-policies.sql",
  )?.seed;

  it("writes the recordings policy for each organization user ClickHouse has", async () => {
    const queries: string[] = [];
    const commands: string[] = [];

    await seed?.({
      query: async <Row>(sql: string) => {
        queries.push(sql);
        return [
          { name: "sql_api_org_a1" },
          { name: "sql_api_org_b'2" },
          { name: "sql_api_org_c3" },
        ] as Row[];
      },
      command: async (sql) => {
        commands.push(sql);
      },
    });

    expect(seed).toBeDefined();
    expect(queries).toEqual([
      "SELECT name FROM system.users WHERE startsWith(name, 'sql_api_org_') ORDER BY name",
    ]);
    expect(commands).toEqual([
      "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_a1_recordings` ON app.`recordings` FOR SELECT USING tenant_id = 'a1' TO `sql_api_org_a1`",
      "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_c3_recordings` ON app.`recordings` FOR SELECT USING tenant_id = 'c3' TO `sql_api_org_c3`",
    ]);
  });
});
