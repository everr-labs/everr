import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import {
  type ParsedCronItem,
  parseCronItems,
  type TaskList,
} from "graphile-worker";
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
};

export const alertCronItems: ParsedCronItem[] = parseCronItems([
  {
    task: ALERT_SCAN_TASK,
    match: "* * * * *",
    identifier: "alerts-scan",
    options: { backfillPeriod: 0 },
  },
]);
