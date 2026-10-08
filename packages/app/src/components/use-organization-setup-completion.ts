import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

export const ORGANIZATION_SETUP_MINIMUM_MS = 2500;

export function useOrganizationSetupCompletion(
  ready: boolean,
  startedAt: number,
  returnTo: string,
) {
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () => {
        void router.navigate({ href: returnTo, replace: true });
      },
      Math.max(0, startedAt + ORGANIZATION_SETUP_MINIMUM_MS - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [ready, startedAt, returnTo, router]);
}
