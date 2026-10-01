import { apiKey } from "@better-auth/api-key";
import { API_KEY_CONFIG } from "./api-key-config";

export function apiKeyPlugin() {
  return apiKey([
    {
      configId: API_KEY_CONFIG.secret.configId,
      references: "organization",
      defaultPrefix: API_KEY_CONFIG.secret.prefix,
      requireName: true,
      disableKeyHashing: false,
      enableMetadata: false,
      // Collector abuse limits are enforced outside Better Auth.
      rateLimit: { enabled: false },
      // Secret key capabilities are chosen explicitly at creation.
    },
    {
      configId: API_KEY_CONFIG.public.configId,
      references: "organization",
      defaultPrefix: API_KEY_CONFIG.public.prefix,
      requireName: true,
      // Browser keys are public identifiers and remain retrievable.
      disableKeyHashing: true,
      enableMetadata: true,
      rateLimit: { enabled: false },
      permissions: { defaultPermissions: { ingest: ["write"] } },
    },
  ]);
}
