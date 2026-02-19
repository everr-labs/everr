import { WorkOS } from "@workos-inc/node";
import { z } from "zod";

const WorkOsEnvSchema = z.object({
  WORKOS_API_KEY: z.string().min(1),
  WORKOS_CLIENT_ID: z.string().min(1),
  WORKOS_REDIRECT_URI: z.string().url(),
  WORKOS_COOKIE_PASSWORD: z.string().min(32),
});

let workosClient: WorkOS | null = null;

function getWorkOsEnv() {
  const parsed = WorkOsEnvSchema.safeParse({
    WORKOS_API_KEY: process.env.WORKOS_API_KEY,
    WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID,
    WORKOS_REDIRECT_URI: process.env.WORKOS_REDIRECT_URI,
    WORKOS_COOKIE_PASSWORD: process.env.WORKOS_COOKIE_PASSWORD,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Missing or invalid WorkOS environment variables: ${issues}`,
    );
  }

  return parsed.data;
}

export function getWorkOS() {
  if (workosClient) {
    return workosClient;
  }

  const env = getWorkOsEnv();

  workosClient = new WorkOS({
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID,
  });

  return workosClient;
}
