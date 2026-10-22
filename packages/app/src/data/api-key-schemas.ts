import type { ApiKey as BetterAuthApiKey } from "@better-auth/api-key";
import type { z } from "zod";

/** UI fields provided by the authentication provider. Runtime rows remain unchanged. */
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
> & { metadata: z.core.util.JSONType };
