import { describe, expect, it, vi } from "vite-plus/test";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("scanner under concurrency", () => {
  it("two concurrent claimers do not claim the same due alert twice", async () => {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: databaseUrl });
    const addWorkerJob = vi.fn().mockResolvedValue(undefined);
    vi.resetModules();
    vi.doMock("@/db/client", () => ({ db: drizzle(pool) }));
    vi.doMock("@/server/worker/jobs", () => ({
      addWorkerJob: (...args: unknown[]) => addWorkerJob(...args),
    }));
    const { scanDueAlerts } = await import("./01-scanner");

    try {
      await pool.query("DELETE FROM alert_definitions WHERE organization_id = 'it-org'");
      await pool.query(`
        INSERT INTO alert_definitions
          (organization_id, repoid, slug, evaluation_interval_seconds, "window",
           document, parsed_query, summary_template, description_template,
           next_evaluation_at, active)
        SELECT
          'it-org',
          'it-repo',
          'it-' || i::text,
          60,
          '5m',
          '{}'::jsonb,
          'q',
          's',
          '',
          now() - interval '100 years',
          true
        FROM generate_series(1, 1000) AS i
      `);
      const {
        rows: [{ started_at: startedAt }],
      } = await pool.query<{ started_at: Date }>("SELECT now() AS started_at");

      const seen = new Set<string>();
      let total = 0;
      while (total < 1000) {
        const [a, b] = await Promise.all([
          scanDueAlerts({ batchSize: 100 }),
          scanDueAlerts({ batchSize: 100 }),
        ]);
        for (const call of addWorkerJob.mock.calls.slice(total)) {
          const payload = call[1] as {
            alertDefinitionId: string;
            scheduledFor: string;
          };
          expect(seen.has(payload.alertDefinitionId)).toBe(false);
          seen.add(payload.alertDefinitionId);
          expect(Date.parse(payload.scheduledFor)).toBeGreaterThanOrEqual(
            startedAt.getTime() - 30_000,
          );
        }
        const claimed = a + b;
        if (claimed === 0) break;
        total += claimed;
      }
      expect(total).toBe(1000);
      expect(addWorkerJob).toHaveBeenCalledTimes(1000);
    } finally {
      await pool
        .query("DELETE FROM alert_definitions WHERE organization_id = 'it-org'")
        .catch(() => {});
      vi.doUnmock("@/db/client");
      vi.doUnmock("@/server/worker/jobs");
      vi.resetModules();
      await pool.end();
    }
  }, 60_000);
});
