import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";
export const appEnv = createEnv({
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  server: {
    POLAR_ACCESS_TOKEN: z.string(),
    POLAR_WEBHOOK_SECRET: z.string(),
    POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
    POLAR_PRO_PRODUCT_ID: z.string().min(1),
    POLAR_PRO_LEGACY_PRODUCT_IDS: z.string().optional(),
  },
  runtimeEnv: {
    POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN,
    POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
    POLAR_SERVER: process.env.POLAR_SERVER,
    POLAR_PRO_PRODUCT_ID: process.env.POLAR_PRO_PRODUCT_ID,
    POLAR_PRO_LEGACY_PRODUCT_IDS: process.env.POLAR_PRO_LEGACY_PRODUCT_IDS,
  },
  emptyStringAsUndefined: true,
});
