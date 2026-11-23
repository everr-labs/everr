import { ClickHouseError } from "@clickhouse/client";
import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import {
  applyClickHouseMigration,
  clickHouseMigrationHash,
  clickHouseMigrationQueryId,
  clickHouseMigrationSteps,
  pendingClickHouseMigrations,
  statementParams,
} from "./clickhouse-migrations";
import {
  changedClickHouseMigrationFiles,
  droppedClickHouseSeedFiles,
  isClickHouseMigrationPath,
  lateClickHouseSeedFiles,
} from "./clickhouse-statements";
import {
  byMigrationName,
  type ClickHouseMigration,
  type ClickHouseSeed,
  clickHouseMigrations,
  clickHouseMigrationsFor,
  clickHouseMigrationTarget,
  sqlStatements,
  withClickHouseSeeds,
} from "./clickhouse-sql";

const migration = (name: string, sql = `SELECT '${name}'`): ClickHouseMigration => ({ name, sql });
const applied = (...migrations: ClickHouseMigration[]) =>
  new Map(migrations.map(({ name, sql }) => [name, clickHouseMigrationHash(sql)]));
const names = (list: readonly { name: string }[]) => list.map(({ name }) => name);

describe("ClickHouse migrations", () => {
  it("bundles the migration files", () => {
    expect(names(clickHouseMigrations)).toContain("0007-create-alert-events.sql");
  });

  it("gives every bundled file its own four-digit number", () => {
    const numbers = names(clickHouseMigrations).map((name) => /^(\d{4})-/.exec(name)?.[1]);

    expect(numbers).not.toContain(undefined);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("gives a product the untagged files and the ones tagged for it", () => {
    const files = [
      migration("0001-setup.sql"),
      migration("0015-cloud-role.sql"),
      migration("0015-self-hosted-role.sql"),
      migration("0012-cloud-apply-rls.sql"),
    ];

    expect(names(clickHouseMigrationsFor("self-hosted", files))).toEqual([
      "0001-setup.sql",
      "0015-self-hosted-role.sql",
    ]);
    expect(names(clickHouseMigrationsFor("cloud", files))).toEqual([
      "0001-setup.sql",
      "0015-cloud-role.sql",
      "0012-cloud-apply-rls.sql",
    ]);
    // The tag sits right after the number. The word elsewhere is not a tag.
    expect(clickHouseMigrationTarget("0030-create-cloud-usage.sql")).toBeUndefined();
  });

  it("keeps tenant row policies out of the self-hosted files", () => {
    const selfHosted = clickHouseMigrationsFor("self-hosted");

    expect(names(selfHosted.filter(({ sql }) => /^CREATE ROW POLICY/m.test(sql)))).toEqual([]);
    expect(names(clickHouseMigrationsFor("cloud"))).toContain("0012-cloud-apply-rls.sql");
  });

  it("orders migrations by file name and skips applied ones", () => {
    const pending = pendingClickHouseMigrations(
      [migration("0003-tables.sql"), migration("0015-role.sql"), migration("0001-setup.sql")],
      applied(migration("0003-tables.sql")),
    );

    expect(names(pending)).toEqual(["0001-setup.sql", "0015-role.sql"]);
  });

  it("rejects two files with one name, because the journal records names", () => {
    expect(() =>
      pendingClickHouseMigrations(
        [migration("0015-role.sql"), migration("0015-role.sql")],
        new Map(),
      ),
    ).toThrow("Duplicate ClickHouse migration 0015-role.sql");
  });

  it("stops before running anything when an applied file changed", () => {
    const before = migration("0003-tables.sql", "CREATE TABLE a (x UInt8)");
    const after = migration("0003-tables.sql", "CREATE TABLE a (x UInt16)");

    expect(() =>
      pendingClickHouseMigrations([after, migration("0004-new.sql")], applied(before)),
    ).toThrow("ClickHouse migrations changed after they were applied: 0003-tables.sql.");
  });

  it("treats a comment edit in an applied file as a change", () => {
    const before = migration("0003-tables.sql", "-- v1\nCREATE TABLE a (x UInt8);\n");
    const after = migration("0003-tables.sql", "-- v1, typo fixed\nCREATE TABLE a (x UInt8);\n");

    expect(() => pendingClickHouseMigrations([after], applied(before))).toThrow(
      "ClickHouse migrations changed after they were applied: 0003-tables.sql.",
    );
  });

  it("gives the local collector's chDB the same errorFingerprint as App and Cloud", () => {
    const collectorCopy = readFileSync(
      new URL(
        "../../../../collector/exporter/chdbexporter/internal/sqltemplates/create_error_fingerprint_function.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const definitions = (sql: string) =>
      sqlStatements(sql).filter((statement) =>
        /^CREATE (OR REPLACE )?FUNCTION (IF NOT EXISTS )?errorFingerprint\b/.test(statement),
      );
    // A change to the function lands in a new file, so compare the latest definition.
    const latest = [...clickHouseMigrations]
      .sort(byMigrationName)
      .flatMap(({ sql }) => definitions(sql))
      .at(-1);

    expect(latest).toBeDefined();
    expect(definitions(collectorCopy)).toEqual([latest]);
  });

  it("splits statements after removing comments that contain semicolons", () => {
    expect(sqlStatements("-- one; two\nCREATE ROLE a;\n\nGRANT b TO a; -- done;\n")).toEqual([
      "CREATE ROLE a",
      "GRANT b TO a",
    ]);
  });

  it("gives a statement a stable query id so a retry cancels the previous run", () => {
    expect(clickHouseMigrationQueryId("0007-create-alert-events.sql", 0)).toBe(
      "everr-ch-0007-create-alert-events_sql-0",
    );
    expect(clickHouseMigrationQueryId("0007-create-alert-events.sql", 1)).toBe(
      "everr-ch-0007-create-alert-events_sql-1",
    );
  });

  it("treats an existing migration file as immutable and a new file as pending", () => {
    const path = "packages/app/clickhouse/0001-setup.sql";
    const base = new Map([[path, "-- old\nSELECT 1;"]]);
    const added = new Map([...base, ["packages/app/clickhouse/0002-next.sql", "SELECT 2;"]]);
    const commented = new Map([[path, "-- new\nSELECT 1;"]]);
    const edited = new Map([[path, "SELECT 3;"]]);
    const deleted = new Map<string, string>();

    expect(changedClickHouseMigrationFiles(base, added)).toEqual([]);
    expect(changedClickHouseMigrationFiles(base, commented)).toEqual([path]);
    expect(changedClickHouseMigrationFiles(base, edited)).toEqual([path]);
    expect(changedClickHouseMigrationFiles(base, deleted)).toEqual([path]);
    expect(isClickHouseMigrationPath(path)).toBe(true);
    expect(isClickHouseMigrationPath("packages/app/clickhouse/repeatable/01.sql")).toBe(false);
    expect(isClickHouseMigrationPath("packages/cloud/clickhouse/0020-apply-rls.sql")).toBe(false);
  });

  it("gives a migration the seed named after it", () => {
    const seed = async () => {};
    const joined = withClickHouseSeeds(
      [migration("0001-setup.sql"), migration("0002-cloud-policies.sql")],
      { "0002-cloud-policies.seed.ts": seed },
    );

    expect(joined.map((file) => file.seed)).toEqual([undefined, seed]);
  });

  it("rejects a seed without a migration, because it would never run", () => {
    expect(() =>
      withClickHouseSeeds([migration("0001-setup.sql")], {
        "0001-set-up.seed.ts": async () => {},
      }),
    ).toThrow("ClickHouse seeds without a migration: 0001-set-up.seed.ts");
  });

  it("rejects a seed file whose default export is not a function", () => {
    for (const exported of [undefined, { run: async () => {} }]) {
      expect(() =>
        withClickHouseSeeds([migration("0001-setup.sql")], {
          "0001-setup.seed.ts": exported,
        }),
      ).toThrow("0001-setup.seed.ts");
    }
  });

  describe("what a migration sends to ClickHouse", () => {
    interface Sent {
      readonly query: string;
      readonly query_id?: string;
      readonly query_params?: Record<string, unknown>;
    }

    const KILL =
      "KILL QUERY WHERE startsWith(query_id, {prefix:String}) AND user = currentUser() SYNC";

    // Keeps every query running until the KILL above names a prefix of its
    // id. Like ClickHouse 26.11, it fails a KILL that matches no query.
    function server() {
      const sent: Sent[] = [];
      const running = new Set<string>();
      const receive = (request: Sent) => {
        sent.push(request);
        if (request.query === KILL) {
          const prefix = String(request.query_params?.prefix);
          const matched = [...running].filter((id) => id.startsWith(prefix));
          if (matched.length === 0) {
            throw new ClickHouseError({
              message: "No query to kill.",
              code: "785",
              type: "NOTHING_TO_KILL",
            });
          }
          for (const id of matched) running.delete(id);
        } else if (request.query_id !== undefined) {
          running.add(request.query_id);
        }
      };
      const client = {
        command: async (request: Sent) => receive(request),
        query: async (request: Sent) => {
          receive(request);
          return { json: async () => [] };
        },
        insert: async () => {},
      } as unknown as Parameters<typeof clickHouseMigrationSteps>[0];
      const start = (seed: ClickHouseSeed) => {
        const file = { ...migration("0002-cloud-policies.sql", "SELECT 1"), seed };
        const hashed = { ...file, hash: clickHouseMigrationHash(file.sql) };
        return applyClickHouseMigration(hashed, clickHouseMigrationSteps(client, hashed, {}));
      };
      const idsOf = (sql: string) =>
        sent.filter(({ query }) => query.startsWith(sql)).map(({ query_id }) => query_id);
      return { sent, running, start, idsOf };
    }

    it("gives each seed query an id of its own", async () => {
      const { start, idsOf } = server();
      await start(async ({ query, command }) => {
        await query("ALTER USER a DEFAULT ROLE NONE");
        await command("ALTER USER b DEFAULT ROLE NONE");
        await command("ALTER USER c DEFAULT ROLE NONE");
      });

      const ids = [...idsOf("SELECT 1"), ...idsOf("ALTER USER")];
      expect(ids).toHaveLength(4);
      expect(ids).not.toContain(undefined);
      expect(new Set(ids).size).toBe(4);
    });

    it("binds a seed query's parameters instead of putting them in the SQL", async () => {
      const { sent, start } = server();
      const sql = "ALTER USER {name:Identifier} DEFAULT ROLE NONE";
      await start(async ({ query, command }) => {
        await command(sql, { name: "odd`name" });
        await query("ALTER USER {id:String}", { id: "it's" });
      });

      expect(
        sent
          .filter(({ query }) => query.startsWith("ALTER USER"))
          .map(({ query, query_params }) => ({ query, query_params })),
      ).toEqual([
        { query: sql, query_params: { name: "odd`name" } },
        { query: "ALTER USER {id:String}", query_params: { id: "it's" } },
      ]);
    });

    it("stops the seed queries of the previous start, even when the retry makes fewer calls", async () => {
      const { running, start, idsOf } = server();
      await start(async ({ command }) => {
        await command("ALTER USER a DEFAULT ROLE NONE");
        await command("ALTER USER b DEFAULT ROLE NONE");
        await command("ALTER USER c DEFAULT ROLE NONE");
      });
      const left = idsOf("ALTER USER");
      let stillRunning: unknown[] = ["the retry did not reach the seed"];
      await start(async ({ command }) => {
        stillRunning = left.filter((id) => id !== undefined && running.has(id));
        await command("ALTER USER a DEFAULT ROLE NONE");
      });

      expect(left).toHaveLength(3);
      expect(stillRunning).toEqual([]);
    });

    it("stops the earlier seed queries before it sends the statements again", async () => {
      const { sent, running, start, idsOf } = server();
      await start(async ({ command }) => {
        await command("ALTER USER a DEFAULT ROLE NONE");
      });
      const retry = sent.length;
      await start(async () => {});

      expect(sent.slice(retry).map(({ query }) => query)).toEqual([KILL, "SELECT 1"]);
      expect([...running]).toEqual([...new Set(idsOf("SELECT 1"))]);
    });
  });

  describe("applying one migration", () => {
    function run(seed: () => Promise<void>) {
      const calls: string[] = [];
      const file = { ...migration("0002-cloud-policies.sql", "SELECT 1;\nSELECT 2;"), seed };
      const done = applyClickHouseMigration(
        { ...file, hash: clickHouseMigrationHash(file.sql) },
        {
          statement: async (statement) => {
            calls.push(statement);
          },
          stopSeedQueries: async () => {
            calls.push("stop seed queries");
          },
          seed: { query: async () => [], command: async () => {} },
          journal: async () => {
            calls.push("journal");
          },
        },
      );
      return { calls, done };
    }

    it("runs the seed after the statements and before the journal row", async () => {
      const { calls, done } = run(async () => {
        calls.push("seed");
      });
      await done;

      expect(calls).toEqual(["stop seed queries", "SELECT 1", "SELECT 2", "seed", "journal"]);
    });

    it("leaves the migration pending when its seed fails", async () => {
      const { calls, done } = run(async () => {
        throw new Error("no access to system.users");
      });

      await expect(done).rejects.toThrow(
        /seed of ClickHouse migration 0002-cloud-policies\.sql.*no access to system\.users/,
      );
      expect(calls).toEqual(["stop seed queries", "SELECT 1", "SELECT 2"]);
    });
  });

  it("rejects a seed added to a migration that is already committed", () => {
    const dir = "packages/app/clickhouse";
    const base = new Set([`${dir}/0001-setup.sql`, `${dir}/0002-old.seed.ts`]);

    expect(
      lateClickHouseSeedFiles(base, [
        `${dir}/0001-setup.sql`,
        `${dir}/0001-setup.seed.ts`,
        `${dir}/0002-old.seed.ts`,
        `${dir}/0003-new.sql`,
        `${dir}/0003-new.seed.ts`,
      ]),
    ).toEqual([`${dir}/0001-setup.seed.ts`]);
  });

  it("rejects a deleted seed, because a new server would apply its migration without it", () => {
    const dir = "packages/app/clickhouse";
    const base = new Set([
      `${dir}/0001-setup.sql`,
      `${dir}/0001-setup.seed.ts`,
      `${dir}/0002-next.sql`,
      `${dir}/0002-next.seed.ts`,
    ]);
    const head = new Set([
      `${dir}/0001-setup.sql`,
      `${dir}/0002-next.sql`,
      `${dir}/0002-next.seed.ts`,
    ]);

    expect(droppedClickHouseSeedFiles(base, head)).toEqual([`${dir}/0001-setup.seed.ts`]);
    expect(droppedClickHouseSeedFiles(base, base)).toEqual([]);
  });

  it("binds only the parameters a statement names", () => {
    expect(
      statementParams("0001-setup.sql", "CREATE USER {name:Identifier} BY {password:String}", {
        name: "sql_api",
        password: "secret",
        unused: "x",
      }),
    ).toEqual({ name: "sql_api", password: "secret" });
  });

  it("names the migration and parameter a statement is missing", () => {
    expect(() =>
      statementParams("0001-setup.sql", "CREATE USER a BY {password:String}", {}),
    ).toThrow("ClickHouse migration 0001-setup.sql needs the password parameter");
  });
});
