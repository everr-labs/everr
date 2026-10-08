import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader } from "@everr/ui/components/card";
import { cn } from "@everr/ui/lib/utils";
import { Check } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";

export interface MultiStepItem<StepId extends string> {
  id: StepId;
  title: string;
  content: ReactNode;
  /** Explanation shown for a confirmed step that was skipped. */
  skipped?: string;
  /** Preserve forms or portaled dialogs while the panel or whole flow is hidden. */
  keepMounted?: boolean;
}

// Controlled: the caller owns progress and confirms when later steps unlock.
export function MultiStep<StepId extends string>({
  steps,
  currentStep,
  furthestStep,
  onStepChange,
  disabled = false,
  navigationLabel = "Progress",
  hidden = false,
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  steps: readonly MultiStepItem<StepId>[];
  currentStep: StepId;
  furthestStep: StepId;
  onStepChange: (step: StepId) => void;
  disabled?: boolean;
  navigationLabel?: string;
}) {
  const id = useId();
  const furthestIndex = steps.findIndex((step) => step.id === furthestStep);

  return (
    <div
      {...props}
      hidden={hidden}
      data-slot="multi-step"
      className={cn(
        "mx-auto w-full min-w-0 max-w-3xl space-y-8 pb-8",
        className,
      )}
    >
      {!hidden && (
        <>
          {children}
          <nav
            aria-label={navigationLabel}
            className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"
          >
            {steps.map((step, index) => {
              const confirmed = index < furthestIndex;
              const skipped = confirmed && step.skipped;
              return (
                <Button
                  key={step.id}
                  type="button"
                  variant={step.id === currentStep ? "secondary" : "ghost"}
                  className="h-auto min-w-0 justify-start gap-2 whitespace-normal px-3 py-3 text-left"
                  disabled={index > furthestIndex || disabled}
                  aria-current={step.id === currentStep ? "step" : undefined}
                  onClick={() => onStepChange(step.id)}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs">
                    {confirmed && !skipped ? (
                      <Check className="size-3" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="min-w-0">
                    {step.title}
                    {skipped && (
                      <span className="block text-xs text-muted-foreground">
                        {skipped}
                      </span>
                    )}
                  </span>
                </Button>
              );
            })}
          </nav>
        </>
      )}

      {steps.map((step) => {
        const active = !hidden && step.id === currentStep;
        if (!active && !step.keepMounted) return null;
        const titleId = `${id}-${step.id}`;
        return (
          <Card
            key={step.id}
            hidden={!active}
            role="region"
            aria-labelledby={titleId}
            className="w-full min-w-0"
          >
            <CardHeader>
              <h2 id={titleId} className="text-xl font-semibold">
                {step.title}
              </h2>
            </CardHeader>
            <CardContent className="min-w-0 space-y-5">
              {step.content}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
