import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createApiKey } from "@/data/api-keys";
import type { ApiKeyScope } from "@/lib/api-key-scopes";
import { authClient } from "@/lib/auth-client";

// better-auth groups keys by `configId`. The value stays "ingest" so keys
// minted before the rename keep resolving; only the UI vocabulary changed.
const API_KEY_CONFIG_ID = "ingest";

type ListResult = Awaited<ReturnType<typeof authClient.apiKey.list>>;
type ListData = NonNullable<ListResult["data"]>;
type RawApiKeys = ListData extends {
  apiKeys: infer A extends readonly unknown[];
}
  ? A
  : ListData extends readonly unknown[]
    ? ListData
    : never;

export type ApiKey = RawApiKeys[number];

const apiKeysQueryKey = ["api-keys"] as const;

async function getActiveOrgId(): Promise<string> {
  const res = await authClient.getSession();
  const orgId = (
    res?.data as { session?: { activeOrganizationId?: string | null } } | null
  )?.session?.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

function unwrapKeys(value: unknown): ApiKey[] {
  if (Array.isArray(value)) return value as ApiKey[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { apiKeys?: unknown }).apiKeys)
  ) {
    return (value as { apiKeys: ApiKey[] }).apiKeys;
  }
  return [];
}

export function apiKeysQueryOptions() {
  return queryOptions({
    queryKey: apiKeysQueryKey,
    queryFn: async () => {
      const organizationId = await getActiveOrgId();
      const res = await authClient.apiKey.list({
        query: { configId: API_KEY_CONFIG_ID, organizationId },
      });
      if (res.error)
        throw new Error(res.error.message ?? "Failed to load API keys");
      const all = unwrapKeys(res.data);
      // Defense-in-depth: if the server didn't filter by configId, do it here.
      return all.filter(
        (k) => (k as { configId?: string }).configId === API_KEY_CONFIG_ID,
      );
    },
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      expiresInDays?: number;
      scopes: ApiKeyScope[];
    }) => {
      // Permissions are server-only on the apiKey plugin, so creation routes
      // through a server function that can set the `permissions` field. The
      // client only picks scopes; the server decides the action set per scope.
      const result = await createApiKey({
        data: {
          name: vars.name,
          ...(vars.expiresInDays !== undefined
            ? { expiresInDays: vars.expiresInDays }
            : {}),
          scopes: vars.scopes,
        },
      });
      return result as unknown as { key: string | null };
    },
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
