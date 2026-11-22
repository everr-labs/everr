import { z } from "zod";

export const HomeSearchSchema = z.object({
  setup: z
    .union([z.literal(1), z.literal("1")])
    .transform(() => 1 as const)
    .optional()
    .catch(undefined),
});

export interface HomeStatus {
  appUrl: string;
  ingestEndpoint?: string;
  canCreateKeys: boolean;
  onboardingCompleted: boolean;
}

type HomeView = "onboarding" | "dashboard";

/** Until the status answers, Home assumes a returning member (the common case),
 *  so the dashboard's panels start loading at once instead of after a skeleton. */
export function homeView(status: HomeStatus | undefined, setupRequested = false): HomeView {
  return setupRequested || status?.onboardingCompleted === false ? "onboarding" : "dashboard";
}
