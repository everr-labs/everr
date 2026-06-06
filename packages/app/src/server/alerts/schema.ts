import { z } from "zod";

const AlertSeveritySchema = z.enum(["critical", "warning"]);
const AlertYamlVersionSchema = z.literal("everr/v1");

const RawAlertSchema = z.object({
  name: z.string().trim().min(1),
  severity: AlertSeveritySchema,
  routing: z.string().trim().min(1),
  evaluationInterval: z.string().trim().min(1),
  window: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1),
});

export const RawAlertFileSchema = z.object({
  version: AlertYamlVersionSchema,
  service: z.string().trim().min(1),
  labels: z.record(z.string(), z.string()).optional().default({}),
  alerts: z.array(RawAlertSchema).min(1),
});
