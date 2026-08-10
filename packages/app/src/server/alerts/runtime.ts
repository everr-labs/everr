import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import {
  type ParsedCronItem,
  parseCronItems,
  type TaskList,
} from "graphile-worker";
import {
  ALERT_EVALUATE_TASK,
  type EvaluatePayload,
} from "@/data/alerting/scheduling/evaluation-jobs.server";
import { serverLogger } from "@/telemetry/logger";
import { flushAlertGroup } from "./delivery/flush-group";
import { processAlertEvent } from "./delivery/process-event";
import { sendAlertDelivery } from "./delivery/send-delivery";
import {
  ALERT_FLUSH_GROUP_TASK,
  ALERT_PROCESS_EVENT_TASK,
  ALERT_SEND_DELIVERY_TASK,
} from "./delivery/tasks";
import { evaluateAlert } from "./evaluation/rule";
import { cleanupAlertingHistory } from "./maintenance/cleanup";
import { scanDueAlerts } from "./scheduling/scanner";

const ALERT_SCAN_TASK = "alerts/scan";
const ALERT_RETENTION_TASK = "alerts/retention";

export const alertTaskList: TaskList = {
  [ALERT_SCAN_TASK]: context.bind(ROOT_CONTEXT, async () => {
    await scanDueAlerts();
  }),
  [ALERT_EVALUATE_TASK]: context.bind(ROOT_CONTEXT, async (payload) => {
    await evaluateAlert(payload as EvaluatePayload);
  }),
  [ALERT_PROCESS_EVENT_TASK]: context.bind(ROOT_CONTEXT, async (payload) => {
    await processAlertEvent(payload);
  }),
  [ALERT_FLUSH_GROUP_TASK]: context.bind(ROOT_CONTEXT, async (payload) => {
    await flushAlertGroup(payload);
  }),
  [ALERT_SEND_DELIVERY_TASK]: context.bind(ROOT_CONTEXT, async (payload) => {
    await sendAlertDelivery(payload);
  }),
  [ALERT_RETENTION_TASK]: context.bind(ROOT_CONTEXT, async () => {
    const counts = await cleanupAlertingHistory();
    const deleted = Object.values(counts).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (deleted > 0) {
      serverLogger.info("alerts.retention.deleted", {
        "alerts.retention.alert_evaluations": counts.alertEvaluations,
        "alerts.retention.deliveries": counts.deliveries,
        "alerts.retention.events": counts.events,
        "alerts.retention.notification_groups": counts.notificationGroups,
        "alerts.retention.silences": counts.silences,
      });
    }
  }),
};

export const alertCronItems: ParsedCronItem[] = parseCronItems([
  {
    task: ALERT_SCAN_TASK,
    match: "* * * * *",
    identifier: "alerts-scan",
    options: { backfillPeriod: 0 },
  },
  {
    task: ALERT_RETENTION_TASK,
    match: "43 3 * * *",
    identifier: "alerts-retention",
    options: { backfillPeriod: 0 },
  },
]);
