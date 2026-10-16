import { queryOptions } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

export function linkedAccountsQueryOptions(userId: string) {
  return queryOptions({
    queryKey: ["account-settings", userId, "linked-accounts"],
    enabled: Boolean(userId),
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error)
        throw new Error(
          result.error.message ?? "Could not load your sign-in methods.",
        );
      return result.data;
    },
  });
}

export function accountSessionsQueryOptions(userId: string) {
  return queryOptions({
    queryKey: ["account-settings", userId, "sessions"],
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error)
        throw new Error(
          result.error.message ?? "Could not load your sessions.",
        );
      return result.data;
    },
  });
}
