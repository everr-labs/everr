import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { HomeStatus } from "@/common/onboarding";
import { completeOnboarding, getHomeStatus } from "./server";

export function homeStatusQueryOptions(userId: string, organizationId: string) {
  return queryOptions({
    queryKey: ["home-status", userId, organizationId],
    queryFn: () => getHomeStatus({ data: { organizationId } }),
    staleTime: 15_000,
    // Another member may complete this organization's onboarding.
    refetchInterval: (query) =>
      query.state.data?.onboardingCompleted ? false : 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useCompleteOnboarding(userId: string, organizationId: string) {
  const queryClient = useQueryClient();
  const { queryKey } = homeStatusQueryOptions(userId, organizationId);
  return useMutation({
    mutationFn: () => completeOnboarding({ data: { organizationId } }),
    onSuccess: async (result) => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<HomeStatus>(queryKey, (status) =>
        status ? { ...status, ...result } : status,
      );
    },
  });
}
