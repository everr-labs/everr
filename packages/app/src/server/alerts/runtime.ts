import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import {
  type Job,
  PgBoss,
  type Queue,
  type QueueOptions,
  type SendOptions,
  type WorkOptions,
} from "pg-boss";
import { pool } from "@/db/client";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { evaluateAlertJob } from "./evaluator";
import { claimDueAlertDefinitions } from "./repository";

type AlertEvaluateJobData = {
  alertDefinitionId: number;
  scheduledFor: string;
};

type AlertScanJobData = Record<string, never>;

const ALERT_SCAN_QUEUE = "alert-scan";
const ALERT_EVALUATE_QUEUE = "alert-evaluate";
const ALERT_DEAD_LETTER_QUEUE = "alert-dead-letter";

const ALERT_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const ALERT_SCAN_BATCH_SIZE = 5_000;

const ALERT_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryBackoff: true,
  expireInSeconds: 60,
  heartbeatSeconds: 30,
  deleteAfterSeconds: ALERT_RETENTION_SECONDS,
  retentionSeconds: ALERT_RETENTION_SECONDS,
} satisfies QueueOptions;

const ALERT_WORK_QUEUE_OPTIONS = {
  ...ALERT_QUEUE_OPTIONS,
  deadLetter: ALERT_DEAD_LETTER_QUEUE,
} satisfies Omit<Queue, "name">;

const ALERT_SEND_OPTIONS = {
  ...ALERT_QUEUE_OPTIONS,
  deadLetter: ALERT_DEAD_LETTER_QUEUE,
} satisfies SendOptions;

const SCAN_WORK_OPTIONS = {
  batchSize: 1,
  localConcurrency: 1,
} satisfies WorkOptions;

const EVALUATE_WORK_OPTIONS = {
  batchSize: 50,
  localConcurrency: 10,
  pollingIntervalSeconds: 1,
} satisfies WorkOptions;

let boss: PgBoss | undefined;

function createBoss(): PgBoss {
  return new PgBoss({
    db: {
      executeSql: (text: string, values?: unknown[]) =>
        pool.query(text, values as unknown[]),
    },
    migrate: true,
  });
}

export async function startAlertRuntime(): Promise<PgBoss> {
  if (boss) return boss;

  serverLogger.info("alerts.runtime.start");
  const nextBoss = createBoss();
  boss = nextBoss;

  try {
    nextBoss.on("error", (error) => {
      serverLogger.error("alerts.pg_boss.error", exceptionAttributes(error));
    });

    await nextBoss.start();

    await Promise.all([
      nextBoss.createQueue(ALERT_DEAD_LETTER_QUEUE, ALERT_QUEUE_OPTIONS),
      nextBoss.createQueue(ALERT_SCAN_QUEUE, ALERT_WORK_QUEUE_OPTIONS),
      nextBoss.createQueue(ALERT_EVALUATE_QUEUE, ALERT_WORK_QUEUE_OPTIONS),
    ]);

    await nextBoss.schedule(
      ALERT_SCAN_QUEUE,
      "* * * * *",
      {},
      {
        ...ALERT_SEND_OPTIONS,
        key: "default",
        singletonKey: ALERT_SCAN_QUEUE,
        singletonSeconds: 60,
      },
    );

    nextBoss.work<AlertScanJobData>(
      ALERT_SCAN_QUEUE,
      SCAN_WORK_OPTIONS,
      context.bind(ROOT_CONTEXT, async (jobs) => {
        await Promise.all(jobs.map(() => processScanJob(nextBoss)));
      }),
    );

    nextBoss.work<AlertEvaluateJobData>(
      ALERT_EVALUATE_QUEUE,
      EVALUATE_WORK_OPTIONS,
      context.bind(ROOT_CONTEXT, async (jobs) => {
        await Promise.all(jobs.map(processEvaluationJob));
      }),
    );

    return nextBoss;
  } catch (error) {
    boss = undefined;
    throw error;
  }
}

async function processScanJob(queue: PgBoss): Promise<void> {
  const claimedAlerts = await claimDueAlertDefinitions({
    limit: ALERT_SCAN_BATCH_SIZE,
    now: new Date(),
  });

  await Promise.all(
    claimedAlerts.map((alert) => {
      const scheduledFor = alert.scheduledFor.toISOString();
      return queue.send(
        ALERT_EVALUATE_QUEUE,
        {
          alertDefinitionId: alert.alertDefinitionId,
          scheduledFor,
        },
        {
          ...ALERT_SEND_OPTIONS,
          id: `alert:${alert.alertDefinitionId}:${scheduledFor}`,
          singletonKey: `alert:${alert.alertDefinitionId}`,
        },
      );
    }),
  );
}

async function processEvaluationJob(
  job: Job<AlertEvaluateJobData>,
): Promise<void> {
  await evaluateAlertJob(job.data);
}

async function stopAlertRuntime(): Promise<void> {
  const activeBoss = boss;
  boss = undefined;
  await activeBoss?.stop();
}

if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    await stopAlertRuntime();
  });
}
