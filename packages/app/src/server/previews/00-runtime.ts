import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import {
  type ParsedCronItem,
  parseCronItems,
  type TaskList,
} from "graphile-worker";
import { sweepOrphanCcRules } from "@/data/alerts/preview-cleanup.server";
import { deleteStalePreviews } from "@/data/previews/apply.server";
import { env } from "@/env";
import { serverLogger } from "@/telemetry/logger";

const PREVIEWS_RETENTION_TASK = "previews/retention";
const PREVIEWS_CC_ORPHAN_SWEEP_TASK = "previews/cc-orphan-sweep";

export const previewsTaskList: TaskList = {
  [PREVIEWS_RETENTION_TASK]: context.bind(ROOT_CONTEXT, async () => {
    const deleted = await deleteStalePreviews(env.EVERR_PREVIEW_RETENTION_DAYS);
    if (deleted > 0) {
      serverLogger.info("previews.retention.deleted", {
        "previews.deleted_count": deleted,
      });
    }
  }),
  // Backstop for deletePreviewCcRules: reaps suppressed CC rules orphaned when
  // CC was unreachable at preview-deletion time.
  [PREVIEWS_CC_ORPHAN_SWEEP_TASK]: context.bind(ROOT_CONTEXT, async () => {
    await sweepOrphanCcRules();
  }),
};

export const previewsCronItems: ParsedCronItem[] = parseCronItems([
  {
    task: PREVIEWS_RETENTION_TASK,
    // Daily, off the minute-boundary rush of the alerts scanner.
    match: "13 3 * * *",
    identifier: "previews-retention",
    options: { backfillPeriod: 0 },
  },
  {
    task: PREVIEWS_CC_ORPHAN_SWEEP_TASK,
    // Hourly, off the minute-boundary rush of the alerts scanner.
    match: "27 * * * *",
    identifier: "previews-cc-orphan-sweep",
    options: { backfillPeriod: 0 },
  },
]);
