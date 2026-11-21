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

/**
 * Until the status answers (`undefined`), Home assumes a returning member and
 * shows the dashboard: that is who opens Home most often, and its panels start
 * loading at once instead of after a skeleton. An organization still
 * onboarding sees the dashboard give way to the steps once. `?setup=1` always
 * means the steps, so it does not wait to find out.
 */
export function homeView(status: HomeStatus | undefined, setupRequested = false): HomeView {
  return setupRequested || status?.onboardingCompleted === false ? "onboarding" : "dashboard";
}
