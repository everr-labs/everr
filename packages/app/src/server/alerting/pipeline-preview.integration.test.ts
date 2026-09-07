// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  alertDefinitions,
  alertEvents,
  alertInstances,
  previews,
} from "@/db/schema";
import { insertPreview, insertRule } from "./testing/fixtures";
import { useAlertingHarness } from "./testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/test-clickhouse"));

const harness = useAlertingHarness();

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
  it("closes a torn-down preview's open instance in the history it leaves behind", async () => {
    const preview = await insertPreview(harness().db);
    await insertRule(harness().db, {
      slug: "preview-rule",
      forSecs: 0,
      previewId: preview.id,
    });
    harness().clickhouse.setSignal(BREACHING);
    await harness().runDueJobs();

    const [firing] = await harness().db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    await agePreview(preview.id, RETENTION_DAYS + 1);
    const { deleteStalePreviews } = await import(
      "@/data/previews/apply.server"
    );
    expect(await deleteStalePreviews(RETENTION_DAYS)).toBe(1);

    // The closing row is a projection with no journal behind it: the cascade
    // took the preview's PostgreSQL rows in the same transaction, so this is
    // the only record that the instance ever ended, and nothing could repair
    // it later from the journal.
    const [closed] = harness().clickhouse.queryRows(`
      SELECT reason, rule_muted, is_live, toString(episode_id) AS episode
      FROM app.alert_events
      WHERE event_type = 'instance_closed'
    `);
    expect(closed.reason).toBe("preview_deleted");
    expect(closed.rule_muted).toBe(true);
    expect(closed.is_live).toBe(false);
    expect(closed.episode).toBe(firing.episodeId);
  });

  it("takes the preview's rules, instances and journal with it", async () => {
    const preview = await insertPreview(harness().db);
    await insertRule(harness().db, {
      slug: "preview-rule",
      forSecs: 0,
      previewId: preview.id,
    });
    harness().clickhouse.setSignal(BREACHING);
    await harness().runDueJobs();
    expect(await harness().db.select().from(alertEvents)).not.toHaveLength(0);

    await agePreview(preview.id, RETENTION_DAYS + 1);
    const { deleteStalePreviews } = await import(
      "@/data/previews/apply.server"
    );
    await deleteStalePreviews(RETENTION_DAYS);

    // One delete, through the cascade: a preview is the parent of everything
    // applied under it, so nothing here is deleted by name.
    expect(await harness().db.select().from(previews)).toHaveLength(0);
    expect(await harness().db.select().from(alertDefinitions)).toHaveLength(0);
    expect(await harness().db.select().from(alertInstances)).toHaveLength(0);
    expect(await harness().db.select().from(alertEvents)).toHaveLength(0);
  });

  it("leaves the live rule beside it firing, in both engines", async () => {
    const preview = await insertPreview(harness().db);
    await insertRule(harness().db, { slug: "live-rule", forSecs: 0 });
    await insertRule(harness().db, {
      slug: "preview-rule",
      forSecs: 0,
      previewId: preview.id,
    });
    harness().clickhouse.setSignal(BREACHING);
    await harness().runDueJobs();

    await agePreview(preview.id, RETENTION_DAYS + 1);
    const { deleteStalePreviews } = await import(
      "@/data/previews/apply.server"
    );
    await deleteStalePreviews(RETENTION_DAYS);

    const surviving = await harness().db.select().from(alertDefinitions);
    expect(surviving.map((row) => row.slug)).toEqual(["live-rule"]);
    // Only the preview's instance was closed. A teardown that closed by age
    // rather than by preview would have ended the live incident too, and the
    // live rule's own history is the place that would show it.
    const closed = harness().clickhouse.queryRows(`
      SELECT slug FROM app.alert_events WHERE event_type = 'instance_closed'
    `);
    expect(closed.map((row) => row.slug)).toEqual(["default/preview-rule"]);
  });

  it("leaves a preview inside its window, and its open instance, alone", async () => {
    const preview = await insertPreview(harness().db);
    await insertRule(harness().db, {
      slug: "preview-rule",
      forSecs: 0,
      previewId: preview.id,
    });
    harness().clickhouse.setSignal(BREACHING);
    await harness().runDueJobs();

    // A preview that is still being applied to is not stale, however long ago
    // it was created: `last_applied_at` is what the cutoff reads, so an active
    // branch never ages out from under a running incident.
    await agePreview(preview.id, RETENTION_DAYS - 1);
    const { deleteStalePreviews } = await import(
      "@/data/previews/apply.server"
    );
    expect(await deleteStalePreviews(RETENTION_DAYS)).toBe(0);

    expect(await harness().db.select().from(alertInstances)).toHaveLength(1);
    expect(
      harness().clickhouse.queryRows(
        "SELECT slug FROM app.alert_events WHERE event_type = 'instance_closed'",
      ),
    ).toEqual([]);
  });
});
