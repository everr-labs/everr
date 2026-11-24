import { describe, expect, it } from "vite-plus/test";
import { cloudClickHouseMigrations } from "./clickhouse-migration-files";

const names = cloudClickHouseMigrations.map(({ name }) => name);

describe("Cloud ClickHouse migrations", () => {
  it("applies the shared files and Cloud's own", () => {
    expect(names).toContain("0007-create-alert-events.sql");
    expect(names).toContain("0012-apply-rls.sql");
    expect(new Set(names).size).toBe(names.length);
  });

  it("leaves the databases and service users to the infrastructure", () => {
    const creates = cloudClickHouseMigrations.filter(({ sql }) =>
      /^\s*CREATE\s+(DATABASE|USER)\b/im.test(sql),
    );

    expect(creates.map(({ name }) => name)).toEqual([]);
  });
});
