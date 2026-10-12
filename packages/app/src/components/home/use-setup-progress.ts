import { useState } from "react";
import { z } from "zod";

const ONBOARDING_STEPS = ["install", "agent", "local", "production"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
const ONBOARDING_MODES = ["agent", "manual"] as const;
type OnboardingMode = (typeof ONBOARDING_MODES)[number];
interface OnboardingProgress {
  step: OnboardingStep;
  mode: OnboardingMode;
}

const ProgressSchema = z.object({
  step: z.enum(ONBOARDING_STEPS).optional(),
  mode: z.enum(ONBOARDING_MODES).nullable().optional(),
});

export function onboardingProgressKey(userId: string, organizationId: string) {
  return `everr:onboarding:${JSON.stringify([userId, organizationId])}`;
}

function readProgress(key: string, completed: boolean): OnboardingProgress {
  const fallback: OnboardingProgress = {
    step: completed ? "production" : "install",
    mode: "agent",
  };
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      // Older browser settings may contain only the method or a null method.
      const parsed = ProgressSchema.parse(JSON.parse(stored));
      return {
        step: parsed.step ?? fallback.step,
        mode: parsed.mode ?? fallback.mode,
      };
    }
  } catch {
    // Restricted storage or stale data should never prevent opening setup.
  }
  return fallback;
}

// The containing component is keyed by user and org to initialize new state.
export function useSetupProgress(
  userId: string,
  organizationId: string,
  completed: boolean,
) {
  const key = onboardingProgressKey(userId, organizationId);
  const [progress, setProgress] = useState(() => readProgress(key, completed));
  const [reviewStep, setReviewStep] = useState<OnboardingStep | null>(null);

  function saveProgress(next: OnboardingProgress) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Setup still works for this visit when the browser disallows storage.
    }
    setProgress(next);
  }

  function advance(nextStep: OnboardingStep, nextMode = progress.mode) {
    const savedStep =
      ONBOARDING_STEPS.indexOf(nextStep) >=
      ONBOARDING_STEPS.indexOf(progress.step)
        ? nextStep
        : progress.step;
    saveProgress({ step: savedStep, mode: nextMode });
    setReviewStep(nextStep === savedStep ? null : nextStep);
  }

  return {
    step: reviewStep ?? progress.step,
    mode: progress.mode,
    furthestStep: progress.step,
    advance,
    selectMode: (mode: OnboardingMode) => saveProgress({ ...progress, mode }),
    review: (step: OnboardingStep) => setReviewStep(step),
  };
}
