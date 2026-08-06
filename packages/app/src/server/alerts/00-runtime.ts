import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import {
  type ParsedCronItem,
  parseCronItems,
  type TaskList,
} from "graphile-worker";
import {
  ALERT_EVALUATE_TASK,
  type EvaluatePayload,
  type EvaluateSloPayload,
  SLO_EVALUATE_TASK,
  scanDueAlerts,
  scanDueSlos,
} from "./01-scanner";
import { evaluateAlert } from "./02-evaluate";
import {
  ALERT_FLUSH_GROUP_TASK,
  ALERT_PROCESS_EVENT_TASK,
  ALERT_SEND_DELIVERY_TASK,
  flushAlertGroup,
  processAlertEvent,
  sendAlertDelivery,
} from "./dispatcher";
import { evaluateSlo } from "./slo-evaluate";

const ALERT_SCAN_TASK = "alerts/scan";

export const alertTaskList: TaskList = {
  [ALERT_SCAN_TASK]: context.bind(ROOT_CONTEXT, async () => {
    await Promise.all([scanDueAlerts(), scanDueSlos()]);
  }),
  [ALERT_EVALUATE_TASK]: context.bind(ROOT_CONTEXT, async (payload) => {
    await evaluateAlert(payload as EvaluatePayload);
  }),
  [SLO_EVALUATE_TASK]: context.bind(ROOT_CONTEXT, async (payload) => {
    await evaluateSlo(payload as EvaluateSloPayload);
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
};

export const alertCronItems: ParsedCronItem[] = parseCronItems([
  {
    task: ALERT_SCAN_TASK,
    match: "* * * * *",
    identifier: "alerts-scan",
    options: { backfillPeriod: 0 },
  },
]);
