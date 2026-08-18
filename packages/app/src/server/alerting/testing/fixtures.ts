import { randomUUID } from "node:crypto";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { encryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import { enqueueAlertEvaluationInTransaction } from "@/data/alerting/scheduling/evaluation-jobs.server";
import type { AlertingMatcher, AlertingRuleSpec } from "@/data/alerting/types";
import type { DbExecutor } from "@/db/client";
import type * as schema from "@/db/schema";
import {
  alertChannels,
  alertDefaultChannels,
  alertDefinitionChannels,
  alertDefinitions,
  alertSilences,
  previews,
} from "@/db/schema";

type Db = PgliteDatabase<typeof schema>;

export const TEST_ORG = "org_test";

/**
 * Repository functions take a `DbExecutor`, typed against node-postgres's
 * `NodePgDatabase`. The harness's `PgliteDatabase` has the same
 * transaction/select/insert/update/delete shape, so it works at runtime, but
 * the two are nominally distinct types drizzle will not assign between. Cast
 * once here rather than re-declaring the same `as never` at every call site.
 */
export function asDbExecutor(db: Db): DbExecutor {
  return db as never;
}

export interface RuleFixture {
  id: string;
  organizationId: string;
  project: string;
  slug: string;
}

interface RuleOverrides {
  organizationId?: string;
  slug?: string;
  sql?: string;
  forSecs?: number;
  intervalSecs?: number;
  labelColumns?: string[];
  severity?: AlertingRuleSpec["severity"];
  resolveAfter?: number;
  nextEvaluationAt?: Date;
  previewId?: string | null;
}

function ruleSpec(overrides: RuleOverrides): AlertingRuleSpec {
  return {
    // Selects the table the case fills with `setSignal`, so the rule's query
    // runs for real and its result changes when the signal does. A case that
    // wants a fixed result still passes its own constant SQL.
    sql: overrides.sql ?? "SELECT * FROM app.test_signal",
    interval_secs: overrides.intervalSecs ?? 60,
    for_secs: overrides.forSecs ?? 0,
    label_columns: overrides.labelColumns ?? ["service"],
    // {operator, threshold} is the real AlertingRuleCondition shape (see
    // AlertingRuleConditionSchema); default breaches against the default
    // sample row's value of 42.
    condition: { operator: "gt", threshold: 0 },
    severity: overrides.severity ?? "warning",
    annotations: { summary: "{{ labels.service }} is breaching" },
    resolve_after: overrides.resolveAfter ?? 1,
  };
}

export async function insertRule(
  db: Db,
  overrides: RuleOverrides = {},
): Promise<RuleFixture> {
  // One transaction, mirroring createRule's own scheduleEvaluation
  // (repository.ts): the API enqueues the first evaluation in the same
  // transaction as the insert, so the job cannot outlive a rolled-back rule
  // and a mutated rule is never left unscheduled by a crash. The scanner
  // cron is only a backstop for a job that went missing after that, not
  // what starts a rule off, so a bare row insert here would sit in the
  // table forever with nothing to evaluate it.
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(alertDefinitions)
      .values({
        organizationId: overrides.organizationId ?? TEST_ORG,
        repoid: "repo_test",
        project: "default",
        slug: overrides.slug ?? "checkout-latency",
        spec: ruleSpec(overrides),
        previewId: overrides.previewId ?? null,
        active: true,
        // Due now, so the scanner picks it up on the first drain.
        nextEvaluationAt: overrides.nextEvaluationAt ?? new Date(),
      })
      .returning({
        id: alertDefinitions.id,
        organizationId: alertDefinitions.organizationId,
        project: alertDefinitions.project,
        slug: alertDefinitions.slug,
        version: alertDefinitions.version,
        nextEvaluationAt: alertDefinitions.nextEvaluationAt,
      });
    await enqueueAlertEvaluationInTransaction(tx as never, {
      alertDefinitionId: inserted.id,
      scheduledFor: (inserted.nextEvaluationAt ?? new Date()).toISOString(),
      ruleVersion: inserted.version,
    });
    return inserted;
  });
  return {
    id: row.id,
    organizationId: row.organizationId,
    project: row.project,
    slug: row.slug,
  };
}

// Postgres's wire protocol counts bind parameters in a signed 16-bit field
// (max 32767); pglite does not surface that as an error, it just drops the
// statement, so a single INSERT with more rows than this allows silently
// inserts nothing. Each row below binds 7 columns, so one statement tops out
// at floor(32767 / 7) = 4681 rows; this stays well under that so the case's
// own row count (whatever it is) never has to know about the ceiling.
const BULK_INSERT_CHUNK_SIZE = 2_000;

/**
 * Many rule rows in as few statements as the parameter ceiling above allows:
 * no per-row transaction, no evaluation-job enqueue. `insertRule` mirrors
 * production's `createRule`, which enqueues the first evaluation in the same
 * transaction as the row insert; calling it hundreds or thousands of times to
 * build a scanner fixture would open that many transactions and enqueue that
 * many jobs the case does not want, and would also defeat the point of the
 * case, which is the scanner *finding* rules that have no job in flight yet.
 * `lastEnqueuedAt` is left at its column default (null) for exactly that
 * reason: it is what makes the scanner's `isNull(lastEnqueuedAt)` branch
 * select these rows. Fixture-only; production never inserts a rule without
 * enqueuing its evaluation.
 */
export async function insertRulesInBulk(
  db: Db,
  count: number,
  overrides: { nextEvaluationAt?: Date } = {},
): Promise<void> {
  const nextEvaluationAt = overrides.nextEvaluationAt ?? new Date();
  for (let start = 0; start < count; start += BULK_INSERT_CHUNK_SIZE) {
    const end = Math.min(start + BULK_INSERT_CHUNK_SIZE, count);
    await db.insert(alertDefinitions).values(
      Array.from({ length: end - start }, (_, offset) => {
        const index = start + offset;
        return {
          organizationId: TEST_ORG,
          repoid: "repo_test",
          project: "default",
          slug: `bulk-rule-${index}`,
          spec: ruleSpec({}),
          active: true,
          nextEvaluationAt,
        };
      }),
    );
  }
}

export async function insertChannel(
  db: Db,
  overrides: {
    organizationId?: string;
    name?: string;
    type?: "slack" | "discord" | "webhook" | "telegram";
    // Telegram only: several chat ids exercise the fan-out, and a chosen
    // token is what a leak test looks for in an error trail.
    botToken?: string;
    chatIds?: string[];
  } = {},
) {
  const organizationId = overrides.organizationId ?? TEST_ORG;
  const name = overrides.name ?? "oncall";
  const type = overrides.type ?? "slack";
  const config =
    type === "telegram"
      ? {
          type,
          bot_token: overrides.botToken ?? "bot-token",
          chat_ids: overrides.chatIds ?? ["1"],
        }
      : // An IP literal, not a hostname: the real sender validates the
        // outbound URL with a live DNS lookup before it ever reaches the
        // stubbed `fetch` (SSRF guard), and "example.test" does not resolve.
        // 203.0.113.0/24 (RFC 5737 TEST-NET-3) is reserved for documentation,
        // never routed, and not on the guard's blocked-range list, so the
        // lookup is skipped and the send reaches the stub.
        { type, url: `https://203.0.113.10/${type}` };
  // The id is generated here and the sealed config goes in with it, the way
  // `createChannel` (delivery/repository.ts) does it.
  const id = randomUUID();
  await db.insert(alertChannels).values({
    id,
    organizationId,
    name,
    encryptedConfig: encryptChannelConfig(organizationId, id, config as never),
  });
  return { id, name };
}

/**
 * A preview row, needed before any rule may carry a `previewId`: the rule's
 * foreign key is composite over (preview_id, organization_id, repoid).
 */
export async function insertPreview(db: Db) {
  const [preview] = await db
    .insert(previews)
    .values({
      organizationId: TEST_ORG,
      repoid: "repo_test",
      name: "gio/branch",
    })
    .returning({ id: previews.id });
  return preview;
}

export async function insertDefaultChannels(
  db: Db,
  overrides: {
    organizationId?: string;
    tier?: "all" | "critical" | "warning" | "info";
    channelIds: string[];
  },
) {
  const organizationId = overrides.organizationId ?? TEST_ORG;
  const tier = overrides.tier ?? "all";
  await db.insert(alertDefaultChannels).values(
    overrides.channelIds.map((channelId, position) => ({
      organizationId,
      tier,
      channelId,
      position,
    })),
  );
}

/** A rule wired straight to one channel: the shortest path to a delivery. */
export async function insertDirectRule(
  db: Db,
  overrides: RuleOverrides & {
    channelType?: "slack" | "discord" | "webhook" | "telegram";
    // Only needed to pin a specific name; the default below already can't
    // collide.
    channelName?: string;
    botToken?: string;
    chatIds?: string[];
  } = {},
): Promise<RuleFixture> {
  const rule = await insertRule(db, overrides);
  const channel = await insertChannel(db, {
    organizationId: rule.organizationId,
    type: overrides.channelType ?? "slack",
    botToken: overrides.botToken,
    chatIds: overrides.chatIds,
    // Slug alone is not unique enough to derive from: a live rule and a
    // preview of it legitimately share (project, slug), since
    // alert_definitions' own uniqueness on that pair is scoped to preview_id
    // IS NULL vs IS NOT NULL separately. rule.id is the row's own primary
    // key, so keying off it makes a channel-name collision structurally
    // impossible rather than merely unlikely, whatever two rules a test
    // wires up in one org.
    name: overrides.channelName ?? `${rule.slug}-${rule.id}-channel`,
  });
  await db.insert(alertDefinitionChannels).values({
    organizationId: rule.organizationId,
    alertDefinitionId: rule.id,
    channelId: channel.id,
    position: 0,
  });
  return rule;
}

export async function insertSilence(
  db: Db,
  overrides: {
    organizationId?: string;
    matchers?: AlertingMatcher[];
    endsAt?: Date;
  } = {},
) {
  const now = new Date();
  const [silence] = await db
    .insert(alertSilences)
    .values({
      organizationId: overrides.organizationId ?? TEST_ORG,
      matchers: overrides.matchers ?? [
        { label: "service", op: "eq", value: "checkout" },
      ],
      startsAt: now,
      endsAt: overrides.endsAt ?? new Date(now.getTime() + 3_600_000),
    })
    .returning({ id: alertSilences.id });
  return silence;
}
