import { describe, expect, it } from "vite-plus/test";
import seed from "./0014-profiles-access.seed.ts";

function server(users: string[]) {
  const commands: string[] = [];
  return {
    commands,
    context: {
      query: async <Row>() => users.map((name) => ({ name })) as Row[],
      command: async (sql: string) => {
        commands.push(sql);
      },
    },
  };
}

describe("0014 profiles access seed", () => {
  it("adds a profiles policy for each SQL API organization user", async () => {
    const { commands, context } = server(["sql_api_org_org-1", "sql_api_org_org_2"]);

    await seed(context);

    expect(commands).toEqual([
      "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_org-1_profiles` ON app.`profiles` FOR SELECT USING tenant_id = 'org-1' TO `sql_api_org_org-1`",
      "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_org_2_profiles` ON app.`profiles` FOR SELECT USING tenant_id = 'org_2' TO `sql_api_org_org_2`",
    ]);
  });

  it("does nothing on a server without organizations", async () => {
    const { commands, context } = server([]);

    await seed(context);

    expect(commands).toEqual([]);
  });

  it("refuses a user name that could break out of the statement", async () => {
    const { commands, context } = server(["sql_api_org_x' OR 1 = 1 --"]);

    await expect(seed(context)).rejects.toThrow("Unexpected SQL API user name");
    expect(commands).toEqual([]);
  });
});
