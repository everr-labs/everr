import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import type { ApiKeyRow } from "@/db/schema/auth";
import {
  ALL_API_KEY_SCOPES,
  API_KEY_SCOPES,
  type ApiKeyPermissions,
  type ApiKeyScope,
} from "@/lib/api-key-scopes";
import { auth } from "@/lib/auth.server";
import {
  buildPublicKeyMetadata,
  type PublicKeyMetadata,
  publicKeyInputError,
} from "@/lib/public-ingest-keys";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

/**
 * The shape of an `ek_` key as the UI receives it. Derived from the DB row
 * (`ApiKeyRow`) so column names stay in lock-step with the schema, but the
 * list endpoint transforms two groups of fields on the way out: JSON
 * serializes `timestamp` columns to ISO strings, and better-auth parses the
 * `permissions` text column into an object. Override exactly those fields.
 */
export type ApiKey = Omit<
  ApiKeyRow,
  "createdAt" | "expiresAt" | "lastRequest" | "permissions" | "metadata"
> & {
  createdAt?: string | Date | null;
  expiresAt?: string | Date | null;
  lastRequest?: string | Date | null;
  permissions?: ApiKeyPermissions;
  metadata?: PublicKeyMetadata | string | null;
};

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
    public: z.boolean().optional(),
    allowedOrigins: z
      .array(z.string().trim().min(1))
      .max(32, "At most 32 origins per key")
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const error = publicKeyInputError(data);
    if (error) {
      ctx.addIssue({
        code: "custom",
        message: error,
        path: ["allowedOrigins"],
      });
    }
  });

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

    const metadata = data.public
      ? buildPublicKeyMetadata(data.allowedOrigins ?? [])
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
        ...(metadata !== undefined ? { metadata } : {}),
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

export const listApiKeys = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }): Promise<ApiKey[]> => {
  // The org comes from the authenticated server-fn context — no extra
  // client round-trip to fetch the session. better-auth's list endpoint
  // reads the session from the request, so forward the headers.
  const result = await auth.api.listApiKeys({
    query: {
      configId: API_KEY_CONFIG_ID,
      organizationId: session.session.activeOrganizationId,
    },
    headers: getRequestHeaders(),
  });
  const keys = (result?.apiKeys ?? []) as ApiKey[];
  // Defense-in-depth: the query already scopes to our configId, but pin it.
  return keys.filter((k) => k.configId === API_KEY_CONFIG_ID);
});

export const ApiKeyCreateInputSchema = CreateApiKeyInput;
