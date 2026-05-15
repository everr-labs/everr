import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

export const INGEST_CONFIG_ID = "ingest";

type ListResult = Awaited<ReturnType<typeof authClient.apiKey.list>>;
type ListData = NonNullable<ListResult["data"]>;
type RawApiKeys = ListData extends {
  apiKeys: infer A extends readonly unknown[];
}
  ? A
  : ListData extends readonly unknown[]
    ? ListData
    : never;

export type IngestKey = RawApiKeys[number];

export const ingestKeysQueryKey = ["ingest-keys"] as const;

async function getActiveOrgId(): Promise<string> {
  const res = await authClient.getSession();
  const orgId = (
    res?.data as { session?: { activeOrganizationId?: string | null } } | null
  )?.session?.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

function unwrapKeys(value: unknown): IngestKey[] {
  if (Array.isArray(value)) return value as IngestKey[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { apiKeys?: unknown }).apiKeys)
  ) {
    return (value as { apiKeys: IngestKey[] }).apiKeys;
  }
  return [];
}

export function ingestKeysQueryOptions() {
  return queryOptions({
    queryKey: ingestKeysQueryKey,
    queryFn: async () => {
      const organizationId = await getActiveOrgId();
      const res = await authClient.apiKey.list({
        query: { configId: INGEST_CONFIG_ID, organizationId },
      });
      if (res.error)
        throw new Error(res.error.message ?? "Failed to load ingest keys");
      const all = unwrapKeys(res.data);
      // Defense-in-depth: if the server didn't filter by configId, do it here.
      return all.filter(
        (k) => (k as { configId?: string }).configId === INGEST_CONFIG_ID,
      );
    },
  });
}

export function useCreateIngestKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; expiresInDays?: number }) => {
      const expiresIn =
        vars.expiresInDays && vars.expiresInDays > 0
          ? vars.expiresInDays * 24 * 60 * 60
          : undefined;
      const organizationId = await getActiveOrgId();
      const res = await authClient.apiKey.create({
        configId: INGEST_CONFIG_ID,
        organizationId,
        name: vars.name,
        ...(expiresIn !== undefined ? { expiresIn } : {}),
      });
      if (res.error)
        throw new Error(res.error.message ?? "Failed to create ingest key");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ingestKeysQueryKey });
    },
  });
}

export function useRevokeIngestKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (keyId: string) => {
      const res = await authClient.apiKey.delete({
        keyId,
        configId: INGEST_CONFIG_ID,
      });
      if (res.error)
        throw new Error(res.error.message ?? "Failed to revoke ingest key");
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ingestKeysQueryKey });
    },
  });
}
