import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createServiceAccount,
  deleteServiceAccount,
  listServiceAccounts,
  revokeServiceAccountSecret,
  rotateServiceAccountSecret,
  type ServiceAccountRole,
} from "@/data/service-accounts";

const serviceAccountsQueryKey = ["service-accounts"] as const;

export function serviceAccountsQueryOptions() {
  return queryOptions({
    queryKey: serviceAccountsQueryKey,
    queryFn: () => listServiceAccounts(),
  });
}

export function useCreateServiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; role: ServiceAccountRole }) =>
      createServiceAccount({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: serviceAccountsQueryKey });
    },
  });
}

export function useRotateServiceAccountSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serviceAccountId: string }) =>
      rotateServiceAccountSecret({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: serviceAccountsQueryKey });
    },
  });
}

export function useRevokeServiceAccountSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { secretId: string }) =>
      revokeServiceAccountSecret({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: serviceAccountsQueryKey });
    },
  });
}

export function useDeleteServiceAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serviceAccountId: string }) =>
      deleteServiceAccount({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: serviceAccountsQueryKey });
    },
  });
}
