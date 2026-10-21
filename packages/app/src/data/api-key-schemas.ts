import { z } from "zod";
import { PublicKeyMetadataSchema } from "#app/lib/public-ingest-keys.ts";

const IdSchema = z.string().min(1);
const AuthDateSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const PermissionsSchema = z.record(z.string(), z.array(z.string()));

const MetadataSchema = z.preprocess(
  (input) => {
    if (typeof input !== "string") return input;
    try {
      const parsed: unknown = JSON.parse(input);
      return parsed;
    } catch {
      return input;
    }
  },
  z
    .union([
      PublicKeyMetadataSchema,
      z.record(z.string(), z.json()).refine((metadata) => metadata.public !== true),
    ])
    .nullish(),
);

// Expose only the fields used by the key list, not the provider's full DB row.
const ApiKeySchema = z.object({
  id: IdSchema,
  configId: IdSchema,
  name: z.string().nullish(),
  start: z.string().nullish(),
  prefix: z.string().nullish(),
  createdAt: AuthDateSchema.nullish(),
  expiresAt: AuthDateSchema.nullish(),
  lastRequest: AuthDateSchema.nullish(),
  permissions: PermissionsSchema.nullish(),
  metadata: MetadataSchema,
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ApiKeysResponseSchema = z.object({ apiKeys: z.array(ApiKeySchema) });

export const CreatedApiKeySchema = z.object({
  id: IdSchema,
  key: z.string().min(1),
  permissions: PermissionsSchema.nullish(),
});
