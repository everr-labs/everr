import type { ApiKey as BetterAuthApiKey } from "@better-auth/api-key";
import { z } from "zod";

// Project the provider's typed fields without exposing its hashed key or owner ID.
// Its metadata type is narrower than the JSON values its endpoints accept.
// Check JSON transport safety here; publicKeyMetadataOf applies Everr's policy.
export const ApiKeyMetadataSchema = z.json();

export type ApiKey = Pick<
  BetterAuthApiKey,
  | "id"
  | "configId"
  | "name"
  | "start"
  | "prefix"
  | "createdAt"
  | "expiresAt"
  | "lastRequest"
  | "permissions"
> & { metadata: z.infer<typeof ApiKeyMetadataSchema> };

// Creation's permissions field is `any` in the provider's endpoint return type.
export const CreatedApiKeySchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  permissions: z.record(z.string(), z.array(z.string())).nullish(),
});
