import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#app/db/client.ts";
import { apikey } from "#app/db/schema/index.ts";
import { auth } from "#app/identity/server.ts";
import { ALL_API_KEY_SCOPES, API_KEY_SCOPES, type ApiKeyScope } from "#app/lib/api-key-scopes.ts";
import {
  allowedOriginsInputError,
  buildPublicKeyMetadata,
  HASHED_KEY_CONFIG_ID,
  PUBLIC_KEY_CONFIG_ID,
  publicKeyInputError,
  publicKeyMetadataOf,
} from "#app/lib/public-ingest-keys.ts";
import { createOrganizationAdminServerFn } from "#app/lib/serverFn.ts";

import type { ApiKey } from "./api-key-schemas";

export type { ApiKey } from "./api-key-schemas";

const SCOPE_INPUT = z.enum(ALL_API_KEY_SCOPES);
const AllowedOriginsInput = z.array(z.string().trim().min(1));

const CreateApiKeyInput = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    expiresInDays: z.number().int().positive("Expiry must be a positive number of days").optional(),
    scopes: z.array(SCOPE_INPUT).min(1, "Pick at least one capability for the key"),
    public: z.boolean().optional(),
    allowedOrigins: AllowedOriginsInput.optional(),
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

const ApiKeyOriginsInputSchema = z
  .object({
    keyId: z.string().trim().min(1),
    allowedOrigins: AllowedOriginsInput.superRefine((origins, ctx) => {
      const error = allowedOriginsInputError(origins);
      if (error) ctx.addIssue({ code: "custom", message: error });
    }),
  })
  .strict();

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
  .validator(CreateApiKeyInput)
  .handler(async ({ data, context: { session } }) => {
    const permissions = permissionsForScopes(data.scopes);

    const expiresIn =
      data.expiresInDays !== undefined ? data.expiresInDays * 24 * 60 * 60 : undefined;

    const metadata = data.public ? buildPublicKeyMetadata(data.allowedOrigins ?? []) : undefined;

    // `permissions` is a server-only field: better-auth rejects it when the
    // create call carries a request/headers (it treats that as a client
    // request). So call without `headers` and identify the actor explicitly
    // via `userId` — better-auth resolves the org membership from userId +
    // organizationId against the DB, no session needed.
    const result = await auth.api.createApiKey({
      body: {
        configId: data.public ? PUBLIC_KEY_CONFIG_ID : HASHED_KEY_CONFIG_ID,
        name: data.name,
        organizationId: session.session.activeOrganizationId,
        userId: session.user.id,
        ...(expiresIn !== undefined ? { expiresIn } : {}),
        permissions,
        ...(metadata !== undefined ? { metadata } : {}),
      },
    });

    // oxlint-disable-next-line typescript/consistent-type-assertions -- Preserve the provider creation response contract without new runtime validation.
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

export const updatePublicKeyOrigins = createOrganizationAdminServerFn({ method: "POST" })
  .validator(ApiKeyOriginsInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const [key] = await db
      .select({ configId: apikey.configId, metadata: apikey.metadata })
      .from(apikey)
      .where(
        and(
          eq(apikey.id, data.keyId),
          eq(apikey.referenceId, session.session.activeOrganizationId),
        ),
      )
      .limit(1);
    if (
      !key ||
      (key.configId !== PUBLIC_KEY_CONFIG_ID && key.configId !== HASHED_KEY_CONFIG_ID) ||
      !publicKeyMetadataOf(key.metadata)
    ) {
      throw new Error("Public key not found");
    }

    const metadata = buildPublicKeyMetadata(data.allowedOrigins);
    const updated = await auth.api.updateApiKey({
      body: {
        configId: key.configId,
        keyId: data.keyId,
        userId: session.user.id,
        metadata,
      },
    });
    // Better Auth can return the previous row if a concurrent revoke wins.
    const savedOrigins = publicKeyMetadataOf(updated?.metadata)?.allowedOrigins;
    if (
      savedOrigins?.length !== metadata.allowedOrigins.length ||
      metadata.allowedOrigins.some((origin, i) => savedOrigins[i] !== origin)
    ) {
      throw new Error("Could not save allowed origins");
    }
  });

export const listApiKeys = createOrganizationAdminServerFn({
  method: "GET",
}).handler(async ({ context: { session } }): Promise<ApiKey[]> => {
  const organizationId = session.session.activeOrganizationId;
  // The org comes from the authenticated server-fn context — no extra
  // client round-trip to fetch the session. better-auth's list endpoint
  // reads the session from the request, so forward the headers. Without a
  // configId it lists the org's keys across every config.
  //
  // better-auth never returns the stored key, so read it for unhashed public
  // keys. Hashed keys (every secret key, and public keys created before the
  // public config existed) can't be shown again.
  const [result, stored] = await Promise.all([
    auth.api.listApiKeys({ query: { organizationId }, headers: getRequestHeaders() }),
    db
      .select({ id: apikey.id, key: apikey.key })
      .from(apikey)
      .where(
        and(eq(apikey.configId, PUBLIC_KEY_CONFIG_ID), eq(apikey.referenceId, organizationId)),
      ),
  ]);
  const fullKeys = new Map(stored.map((row) => [row.id, row.key]));
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Preserve provider rows and metadata verbatim rather than projecting or validating them.
  const keys = (result?.apiKeys ?? []) as ApiKey[];
  // Defense-in-depth: only our own key configs, and rows without a full key
  // pass through untouched.
  return keys
    .filter((k) => k.configId === HASHED_KEY_CONFIG_ID || k.configId === PUBLIC_KEY_CONFIG_ID)
    .map((k) => {
      const fullKey = fullKeys.get(k.id);
      return fullKey === undefined ? k : { ...k, fullKey };
    });
});

export const ApiKeyCreateInputSchema = CreateApiKeyInput;
