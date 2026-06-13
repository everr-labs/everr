import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import {
  type ParsedCronItem,
  parseCronItems,
  type TaskList,
} from "graphile-worker";
import { ALERT_DELIVER_TASK, runDeliverySend } from "./delivery";
import { evaluateAlert } from "./evaluate";
import {
  ALERT_EVALUATE_TASK,
  type EvaluatePayload,
  scanDueAlerts,
} from "./scanner";

const ALERT_SCAN_TASK = "alerts/scan";

export const alertTaskList: TaskList = {
  [ALERT_SCAN_TASK]: context.bind(ROOT_CONTEXT, async () => {
    await scanDueAlerts();
  }),
  [ALERT_EVALUATE_TASK]: context.bind(ROOT_CONTEXT, async (payload) => {
    await evaluateAlert(payload as EvaluatePayload);
  }),
  [ALERT_DELIVER_TASK]: context.bind(ROOT_CONTEXT, async (payload, helpers) => {
    await runDeliverySend(payload, helpers.job);
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
