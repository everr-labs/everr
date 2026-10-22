import { z } from "zod";

const schema = z.object({
  GITHUB_APP_INSTALL_URL: z.url(),
  GITHUB_APP_STATE_SECRET: z.string().min(32),
  GITHUB_APP_WEBHOOK_SECRET: z.string().min(32),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  INGRESS_COLLECTOR_URL: z.url(),
});

export type GithubConfiguration = z.infer<typeof schema>;

// Configuration is owned by the integration, not by the product's environment.
// Existing configured installations remain enabled without a new flag.
export function resolveGithubConfiguration(
  values: Record<string, string | undefined>,
): GithubConfiguration | undefined {
  const enabled = values.EVERR_GITHUB_ENABLED;
  if (enabled !== undefined && enabled !== "true" && enabled !== "false") {
    throw new Error("EVERR_GITHUB_ENABLED must be true or false");
  }
  if (enabled === "false") return undefined;
  const configured = Object.keys(schema.shape).some((key) =>
    values[key]?.trim(),
  );
  if (enabled !== "true" && !configured) return undefined;
  const result = schema.safeParse(values);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path[0])),
    ];
    throw new Error(
      `Invalid GitHub integration configuration: ${fields.join(", ")}`,
    );
  }
  return result.data;
}

export function getGithubConfiguration() {
  if (process.env.TSS_PRERENDERING === "true") return undefined;
  return resolveGithubConfiguration(process.env);
}

export function requireGithubConfiguration(): GithubConfiguration {
  const configuration = getGithubConfiguration();
  if (!configuration) throw new Error("GitHub integration is disabled");
  return configuration;
}
