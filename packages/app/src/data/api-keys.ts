import { z } from "zod";
import {
  ALL_API_KEY_SCOPES,
  API_KEY_SCOPES,
  type ApiKeyScope,
} from "@/lib/api-key-scopes";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

const SCOPE_INPUT = z.enum(ALL_API_KEY_SCOPES);

const CreateApiKeyInput = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    expiresInDays: z
      .number()
      .int()
      .positive("Expiry must be a positive number of days")
      .optional(),
    scopes: z
      .array(SCOPE_INPUT)
      .min(1, "Pick at least one capability for the key"),
  })
  .strict();

// The single better-auth config shared by every `ek_` key, whatever its
// capabilities. The value stays "ingest" for backward compatibility.
const API_KEY_CONFIG_ID = "ingest";

/**
 * Resolve the user's chosen scopes into the better-auth `permissions` map.
 * Each scope gets its full action set; this is the only place in the app
 * where new keys get a non-default permission set, so the mapping is
 * centralized here and kept in lock-step with `API_KEY_SCOPES` in
 * `api-key-scopes.ts`.
 */
export function permissionsForScopes(scopes: readonly ApiKeyScope[]): {
  [scope: string]: string[];
} {
  const permissions: { [scope: string]: string[] } = {};
  for (const scope of scopes) {
    permissions[scope] = [...API_KEY_SCOPES[scope].actions];
  }
  return permissions;
}

export const createApiKey = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(CreateApiKeyInput)
  .handler(async ({ data, context: { session } }) => {
    const permissions = permissionsForScopes(data.scopes);

    const expiresIn =
      data.expiresInDays !== undefined
        ? data.expiresInDays * 24 * 60 * 60
        : undefined;

    // `permissions` is a server-only field: better-auth rejects it when the
    // create call carries a request/headers (it treats that as a client
    // request). So call without `headers` and identify the actor explicitly
    // via `userId` — better-auth resolves the org membership from userId +
    // organizationId against the DB, no session needed.
    const result = await auth.api.createApiKey({
      body: {
        configId: API_KEY_CONFIG_ID,
        name: data.name,
        organizationId: session.session.activeOrganizationId,
        userId: session.user.id,
        ...(expiresIn !== undefined ? { expiresIn } : {}),
        permissions,
      },
    });

    const created = result as {
      key?: string | null;
      id?: string;
      permissions?: Record<string, string[]> | null;
    } | null;

    // The full key is only ever returned at creation; a missing/null one means
    // creation didn't actually succeed, so fail loudly rather than handing the
    // caller a null key.
    if (!created || typeof created.key !== "string" || !created.id) {
      throw new Error("Server did not return a key");
    }

    return {
      key: created.key,
      id: created.id,
      permissions: created.permissions ?? permissions,
    };
  });

export const ApiKeyCreateInputSchema = CreateApiKeyInput;
