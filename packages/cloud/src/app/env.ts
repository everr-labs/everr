import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";
import { readBrevoConfig } from "../crm/brevo/config";

export const appEnv = createEnv({
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  server: {
    // Server-only CRM configuration. The shared parser below validates configured mode.
    CRM_BREVO_MODE: z.enum(["disabled", "configured"]).default("disabled"),
    CRM_BREVO_API_KEY: z.string().optional(),
    CRM_BREVO_TIMEOUT_MS: z.string().optional(),
    CLICKHOUSE_SQL_API_MASTER_KEY: z.string().min(32),
    // Shared environment validation checks the SMTP URL and sender format.
    EMAIL_DSN: z.string().min(1),
    EMAIL_FROM: z.string().min(1),
    POLAR_ACCESS_TOKEN: z.string(),
    POLAR_WEBHOOK_SECRET: z.string(),
    POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
    POLAR_PRO_PRODUCT_ID: z.string().min(1),
    POLAR_PRO_LEGACY_PRODUCT_IDS: z.string().optional(),
  },
  runtimeEnv: {
    CRM_BREVO_MODE: process.env.CRM_BREVO_MODE,
    CRM_BREVO_API_KEY: process.env.CRM_BREVO_API_KEY,
    CRM_BREVO_TIMEOUT_MS: process.env.CRM_BREVO_TIMEOUT_MS,
    CLICKHOUSE_SQL_API_MASTER_KEY: process.env.CLICKHOUSE_SQL_API_MASTER_KEY,
    EMAIL_DSN: process.env.EMAIL_DSN,
    EMAIL_FROM: process.env.EMAIL_FROM,
    POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN,
    POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
    POLAR_SERVER: process.env.POLAR_SERVER,
    POLAR_PRO_PRODUCT_ID: process.env.POLAR_PRO_PRODUCT_ID,
    POLAR_PRO_LEGACY_PRODUCT_IDS: process.env.POLAR_PRO_LEGACY_PRODUCT_IDS,
  },
  emptyStringAsUndefined: true,
});

// Share conditional key/timeout validation with the standalone CRM admission script.
// Cloud consumers read appEnv so empty-value normalization is consistent.
if (process.env.SKIP_ENV_VALIDATION !== "true") readBrevoConfig(appEnv);
