import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createApiKey, listApiKeys } from "@/data/api-keys";
import type { ApiKeyScope } from "@/lib/api-key-scopes";
import { authClient } from "@/lib/auth-client";

export type { ApiKey } from "@/data/api-keys";

// better-auth groups keys by `configId`. The value stays "ingest" so keys
// minted before the rename keep resolving; only the UI vocabulary changed.
const API_KEY_CONFIG_ID = "ingest";

const apiKeysQueryKey = ["api-keys"] as const;

export function apiKeysQueryOptions() {
  return queryOptions({
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
    }) =>
      createApiKey({
        data: {
          name: vars.name,
          ...(vars.expiresInDays !== undefined
            ? { expiresInDays: vars.expiresInDays }
            : {}),
          scopes: vars.scopes,
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
    mutationFn: async (keyId: string) => {
      const res = await authClient.apiKey.delete({
        keyId,
        configId: API_KEY_CONFIG_ID,
      });
      if (res.error)
        throw new Error(res.error.message ?? "Failed to revoke API key");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeysQueryKey });
    },
  });
}
