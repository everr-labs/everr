import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import type { ApiKeyRow } from "@/db/schema/auth";
import { apikey } from "@/db/schema/auth";
import { API_KEY_CONFIG } from "@/lib/api-key-config";
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
  publicKeyMetadataOf,
} from "@/lib/public-ingest-keys";
import { createOrganizationAdminServerFn } from "@/lib/serverFn";

/** Safe list projection: the authentication hash never leaves the database. */
export type ApiKey = Pick<
  ApiKeyRow,
  "id" | "configId" | "name" | "start" | "prefix" | "enabled"
> & {
  createdAt?: string | Date | null;
  expiresAt?: string | Date | null;
  lastRequest?: string | Date | null;
  permissions?: ApiKeyPermissions;
  metadata?: PublicKeyMetadata | string | null;
  publicKey: string | null;
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

export const createApiKey = createOrganizationAdminServerFn({ method: "POST" })
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
        configId: data.public
          ? API_KEY_CONFIG.public.configId
          : API_KEY_CONFIG.secret.configId,
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

    // Better Auth returns the full key at creation; a missing/null one means
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

export const listApiKeys = createOrganizationAdminServerFn({
  method: "GET",
}).handler(async ({ context: { session } }): Promise<ApiKey[]> => {
  const rows = await db
    .select({
      id: apikey.id,
      configId: apikey.configId,
      name: apikey.name,
      start: apikey.start,
      prefix: apikey.prefix,
      enabled: apikey.enabled,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      lastRequest: apikey.lastRequest,
      permissions: apikey.permissions,
      metadata: apikey.metadata,
      // Only public values are returned; secret hashes stay in Postgres.
      publicKey: sql<
        string | null
      >`case when ${apikey.configId} = ${API_KEY_CONFIG.public.configId} then ${apikey.key} else null end`,
    })
    .from(apikey)
    .where(
      and(
        eq(apikey.referenceId, session.session.activeOrganizationId),
        inArray(apikey.configId, [
          API_KEY_CONFIG.public.configId,
          API_KEY_CONFIG.secret.configId,
        ]),
      ),
    )
    .orderBy(desc(apikey.createdAt));
  return rows.map((row) => ({
    ...row,
    permissions: row.permissions ? JSON.parse(row.permissions) : null,
    metadata:
      row.configId === API_KEY_CONFIG.public.configId
        ? publicKeyMetadataOf(row.metadata)
        : null,
  }));
});

export const ApiKeyCreateInputSchema = CreateApiKeyInput;
