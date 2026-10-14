import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Retention is part of the storage partition key. Keep the supported windows bounded.
const days = z
  .enum(["1", "7", "14", "30", "90", "180", "365"])
  .transform(Number);

export const appEnv = createEnv({
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  server: {
    EVERR_SETUP_TOKEN: z.string().min(32).max(1024).optional(),
    EVERR_RETENTION_DAYS: days.default(30),
    EVERR_RETENTION_TRACES_DAYS: days.optional(),
    EVERR_RETENTION_LOGS_DAYS: days.optional(),
    EVERR_RETENTION_METRICS_DAYS: days.optional(),
    EVERR_RETENTION_ALERT_EVALUATIONS_DAYS: days.optional(),
    EVERR_RETENTION_ALERT_LIFECYCLE_DAYS: days.optional(),
  },
  runtimeEnv: {
    EVERR_SETUP_TOKEN: process.env.EVERR_SETUP_TOKEN,
    EVERR_RETENTION_DAYS: process.env.EVERR_RETENTION_DAYS,
    EVERR_RETENTION_TRACES_DAYS: process.env.EVERR_RETENTION_TRACES_DAYS,
    EVERR_RETENTION_LOGS_DAYS: process.env.EVERR_RETENTION_LOGS_DAYS,
    EVERR_RETENTION_METRICS_DAYS: process.env.EVERR_RETENTION_METRICS_DAYS,
    EVERR_RETENTION_ALERT_EVALUATIONS_DAYS:
      process.env.EVERR_RETENTION_ALERT_EVALUATIONS_DAYS,
    EVERR_RETENTION_ALERT_LIFECYCLE_DAYS:
      process.env.EVERR_RETENTION_ALERT_LIFECYCLE_DAYS,
  },
  emptyStringAsUndefined: true,
});
