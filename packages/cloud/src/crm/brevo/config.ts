import * as z from "zod";

const enabled = z.object({
  mode: z.enum(["configured", "paused"]),
  apiKey: z.string().trim().min(1),
  timeoutMs: z.coerce.number().int().min(100).max(30_000).default(10_000),
});

type BrevoConfig = { mode: "disabled" } | z.infer<typeof enabled>;

/** Configuration validation never includes Zod issues or input values in errors. */
export function readBrevoConfig(env: {
  CRM_BREVO_MODE?: string;
  CRM_BREVO_API_KEY?: string;
  CRM_BREVO_TIMEOUT_MS?: string;
}): BrevoConfig {
  const mode = env.CRM_BREVO_MODE ?? "disabled";
  if (mode === "disabled") return { mode };
  const parsed = enabled.safeParse({
    mode,
    apiKey: env.CRM_BREVO_API_KEY,
    timeoutMs: env.CRM_BREVO_TIMEOUT_MS,
  });
  if (!parsed.success) throw new Error("Invalid Brevo CRM configuration.");
  return parsed.data;
}
