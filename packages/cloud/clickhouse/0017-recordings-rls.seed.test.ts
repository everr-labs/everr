import { expect, it } from "vite-plus/test";
import seed from "./0017-recordings-rls.seed.ts";

it("writes the recordings policy for each organization user ClickHouse has", async () => {
  const queries: unknown[] = [];
  const commands: string[] = [];

  await seed({
    query: async <Row>(sql: string, params?: unknown) => {
      queries.push([sql, params]);
      return [
        { name: "sql_api_org_a1" },
        { name: "sql_api_org_b'2" },
        { name: "sql_api_org_" },
        { name: "sql_api_org_c3" },
      ] as Row[];
    },
    command: async (sql) => {
      commands.push(sql);
    },
  });

  expect(queries).toEqual([
    [
      "SELECT name FROM system.users WHERE startsWith(name, {prefix:String}) ORDER BY name",
      { prefix: "sql_api_org_" },
    ],
  ]);
  expect(commands).toEqual([
    "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_a1_recordings` ON app.`recordings` FOR SELECT USING tenant_id = 'a1' TO `sql_api_org_a1`",
    "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_c3_recordings` ON app.`recordings` FOR SELECT USING tenant_id = 'c3' TO `sql_api_org_c3`",
  ]);
});
