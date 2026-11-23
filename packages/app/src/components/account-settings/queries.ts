import { appQueryOptions } from "@everr/ui/lib/query-options";
import { listMcpConnections } from "#app/data/mcp/connections.ts";
import { authClient } from "#app/lib/auth-client.ts";

export function linkedAccountsQueryOptions(userId: string) {
  return appQueryOptions({
    queryKey: ["account-settings", userId, "linked-accounts"],
    enabled: Boolean(userId),
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error)
        throw new Error(result.error.message ?? "Could not load your sign-in methods.");
      return result.data;
    },
  });
}

export function accountSessionsQueryOptions(userId: string) {
  return appQueryOptions({
    queryKey: ["account-settings", userId, "sessions"],
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) throw new Error(result.error.message ?? "Could not load your sessions.");
      return result.data;
    },
  });
}

export function mcpConnectionsQueryOptions(userId: string) {
  return appQueryOptions({
    queryKey: ["account-settings", userId, "mcp-connections"],
    queryFn: () => listMcpConnections(),
  });
}
