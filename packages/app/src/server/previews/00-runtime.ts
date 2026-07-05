import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { type ParsedCronItem, parseCronItems, type TaskList } from "graphile-worker";
import { deleteStalePreviews } from "@/data/previews/apply.server";
import { env } from "@/env";
import { serverLogger } from "@/telemetry/logger";

const PREVIEWS_RETENTION_TASK = "previews/retention";

export const previewsTaskList: TaskList = {
  [PREVIEWS_RETENTION_TASK]: context.bind(ROOT_CONTEXT, async () => {
    const deleted = await deleteStalePreviews(env.EVERR_PREVIEW_RETENTION_DAYS);
    if (deleted > 0) {
      serverLogger.info("previews.retention.deleted", {
        "previews.deleted_count": deleted,
      });
    }
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
]);
