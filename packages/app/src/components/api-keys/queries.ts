import { appQueryOptions } from "@everr/ui/lib/query-options";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiKey, listApiKeys, updatePublicKeyOrigins } from "#app/data/api-keys.ts";
import type { ApiKeyScope } from "#app/lib/api-key-scopes.ts";
import { authClient } from "#app/lib/auth-client.ts";

export type { ApiKey } from "#app/data/api-keys.ts";

const apiKeysQueryKey = ["api-keys"] as const;

export function apiKeysQueryOptions() {
  return appQueryOptions({
    queryKey: apiKeysQueryKey,
    // The server fn resolves the active org from its authenticated context, so
    // there's no separate client round-trip to fetch the session.
    queryFn: () => listApiKeys(),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    // Permissions are server-only on the apiKey plugin, so creation routes
    // through a server function that can set the `permissions` field. The
    // client only picks scopes; the server decides the action set per scope.
    mutationFn: (vars: {
      name: string;
      expiresInDays?: number;
      scopes: ApiKeyScope[];
      public?: boolean;
      allowedOrigins?: string[];
    }) =>
      createApiKey({
        data: {
          name: vars.name,
          ...(vars.expiresInDays !== undefined ? { expiresInDays: vars.expiresInDays } : {}),
          scopes: vars.scopes,
          ...(vars.public ? { public: true, allowedOrigins: vars.allowedOrigins ?? [] } : {}),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    // better-auth only finds a key under its own config.
    mutationFn: async (key: { id: string; configId: string }) => {
      const res = await authClient.apiKey.delete({
        keyId: key.id,
        configId: key.configId,
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to revoke API key");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });
}

export function useUpdatePublicKeyOrigins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { keyId: string; allowedOrigins: string[] }) =>
      updatePublicKeyOrigins({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: apiKeysQueryKey }),
  });
}
