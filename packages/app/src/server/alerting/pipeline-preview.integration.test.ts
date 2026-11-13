// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vite-plus/test";
import { alertDefinitions, alertEvents, alertInstances, previews } from "#app/db/schema/index.ts";
import { insertPreview, insertRule } from "#app/server/alerting/testing/fixtures.ts";
import { registerAlertingHarness } from "#app/testing/alerting-harness.ts";

vi.mock("#app/db/client.ts", async () => {
  const { testDb, runInTransaction } = await import("#app/server/alerting/testing/db-proxy.ts");
  return { db: testDb, runInTransaction };
});

vi.mock("#app/lib/clickhouse.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});
vi.mock("#app/lib/clickhouse-writer.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});

const harness = registerAlertingHarness();

const BREACHING = [{ service: "checkout", value: 42 }];
const DAY_MS = 24 * 60 * 60 * 1_000;
const RETENTION_DAYS = 7;

/** Age a preview past the retention cutoff without waiting for the clock. */
async function agePreview(id: string, days: number): Promise<void> {
  await harness()
    .db.update(previews)
    .set({ lastAppliedAt: new Date(Date.now() - days * DAY_MS) })
    .where(eq(previews.id, id));
}

/**
 * Tearing down a preview, across both engines at once.
 *
 * `preview-teardown.ts` had no test of any kind, and the reason is visible in
 * what it does: it reads open instances from PostgreSQL inside the delete's
 * own transaction, lets the cascade take the preview's rules and journal rows,
 * and then writes the closing rows to ClickHouse. Neither engine on its own
 * can show that, because the whole point is that the PostgreSQL record is gone
 * and the ClickHouse record is what survives it.
 */
describe("the alerting pipeline's preview teardown", () => {
  it("leaves a preview inside its window alone, then tears it down whole, closing its instance in history and leaving the live rule beside it firing", async () => {
    const preview = await insertPreview(harness().db);
    const liveRule = await insertRule(harness().db, { slug: "live-rule", forSecs: 0 });
    const previewRule = await insertRule(harness().db, {
      slug: "preview-rule",
      forSecs: 0,
      previewId: preview.id,
    });
    harness().clickhouse.setSignal(BREACHING);
    await harness().runDueJobs();

    const [previewInstance] = await harness()
      .db.select()
      .from(alertInstances)
      .where(eq(alertInstances.alertDefinitionId, previewRule.id));
    expect(previewInstance.status).toBe("firing");
    const { deleteStalePreviews } = await import("#app/data/previews/apply.server.ts");
    const closedSlugs = () =>
      harness()
        .clickhouse.queryRows(
          "SELECT slug FROM app.alert_events WHERE event_type = 'instance_closed'",
        )
        .map((row) => row.slug);

    // A preview that is still being applied to is not stale, however long ago
    // it was created: `last_applied_at` is what the cutoff reads, so an active
    // branch never ages out from under a running incident.
    await agePreview(preview.id, RETENTION_DAYS - 1);
    expect(await deleteStalePreviews(RETENTION_DAYS)).toBe(0);
    expect(await harness().db.select().from(alertInstances)).toHaveLength(2);
    expect(closedSlugs()).toEqual([]);

    await agePreview(preview.id, RETENTION_DAYS + 1);
    expect(await deleteStalePreviews(RETENTION_DAYS)).toBe(1);

    // The closing row is a projection with no journal behind it: the cascade
    // took the preview's PostgreSQL rows in the same transaction, so this is
    // the only record that the instance ever ended, and nothing could repair
    // it later from the journal. Only the preview's instance was closed: a
    // teardown that closed by age rather than by preview would have ended the
    // live incident too.
    const closed = harness().clickhouse.queryRows(`
      SELECT slug, reason, rule_muted, is_live, toString(episode_id) AS episode
      FROM app.alert_events
      WHERE event_type = 'instance_closed'
    `);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      slug: "default/preview-rule",
      reason: "preview_deleted",
      rule_muted: true,
      is_live: false,
      episode: previewInstance.episodeId,
    });

    // One delete, through the cascade: a preview is the parent of everything
    // applied under it, so nothing here is deleted by name.
    expect(await harness().db.select().from(previews)).toHaveLength(0);
    const surviving = await harness().db.select().from(alertDefinitions);
    expect(surviving.map((row) => row.slug)).toEqual(["live-rule"]);
    const instances = await harness().db.select().from(alertInstances);
    expect(instances.map((row) => [row.alertDefinitionId, row.status])).toEqual([
      [liveRule.id, "firing"],
    ]);
    const events = await harness().db.select().from(alertEvents);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((row) => row.sourceDefinitionId === liveRule.id)).toBe(true);
  });
});
