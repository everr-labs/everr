import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);

export const alertEnv = createEnv({
  isServer: true,
  server: {
    EVERR_ALERTS_ENABLED: z
      .string()
      .optional()
      .transform((value) => TRUE_VALUES.has(value?.toLowerCase().trim() ?? "")),
  },
  runtimeEnv: {
    EVERR_ALERTS_ENABLED: process.env.EVERR_ALERTS_ENABLED,
  },
  emptyStringAsUndefined: true,
});
