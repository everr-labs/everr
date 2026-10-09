import { z } from "zod";

export const HomeSearchSchema = z.object({
  setup: z
    .union([z.literal(1), z.literal("1")])
    .transform(() => 1 as const)
    .optional()
    .catch(undefined),
});

export interface HomeStatus {
  organizationName: string;
  canCreateKeys: boolean;
  onboardingCompleted: boolean;
}

type HomeView = "onboarding" | "dashboard";

export function homeView(status: HomeStatus, setupRequested = false): HomeView {
  return setupRequested || !status.onboardingCompleted
    ? "onboarding"
    : "dashboard";
}
