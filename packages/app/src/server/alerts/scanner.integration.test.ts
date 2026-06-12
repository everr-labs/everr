import { describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("scanner under concurrency", () => {
  it("two concurrent claimers do not claim the same due alert twice", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        "DELETE FROM alert_definitions WHERE organization_id = 'it-org'",
      );
      const values = Array.from(
        { length: 1000 },
        (_, i) =>
          `('it-org','it-repo','it-${i}',60,'5m','','q','s','', now() - interval '1 second', true)`,
      ).join(",");
      await pool.query(`
        INSERT INTO alert_definitions
          (organization_id, repoid, slug, evaluation_interval_seconds, "window",
           raw_yaml, parsed_query, summary_template, description_template,
           next_evaluation_at, active)
        VALUES ${values}
      `);

      const claim = (batch: number) =>
        pool.query(`
          WITH due AS (
            SELECT id, next_evaluation_at
            FROM alert_definitions
            WHERE active
              AND next_evaluation_at <= now()
              AND organization_id = 'it-org'
            ORDER BY next_evaluation_at
            LIMIT ${batch}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE alert_definitions d
          SET next_evaluation_at = due.next_evaluation_at + make_interval(secs => d.evaluation_interval_seconds)
          FROM due
          WHERE d.id = due.id
          RETURNING d.id
        `);

      const seen = new Set<string>();
      let total = 0;
      while (total < 1000) {
        const [a, b] = await Promise.all([claim(100), claim(100)]);
        for (const row of [...a.rows, ...b.rows]) {
          expect(seen.has(row.id)).toBe(false);
          seen.add(row.id);
        }
        const claimed = a.rows.length + b.rows.length;
        if (claimed === 0) break;
        total += claimed;
      }
      expect(total).toBe(1000);
    } finally {
      await pool
        .query("DELETE FROM alert_definitions WHERE organization_id = 'it-org'")
        .catch(() => {});
      await pool.end();
    }
  }, 60_000);
});
