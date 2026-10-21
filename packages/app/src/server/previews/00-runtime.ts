import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { type ParsedCronItem, parseCronItems, type TaskList } from "graphile-worker";
import { deleteStalePreviews } from "#app/data/previews/apply.server.ts";
import { env } from "#app/env/index.ts";
import { serverLogger } from "#app/telemetry/logger.ts";

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
