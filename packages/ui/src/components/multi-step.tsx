import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@everr/ui/components/card";
import { cn } from "@everr/ui/lib/utils";
import { ArrowLeft, Check } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

export interface MultiStepItem<StepId extends string> {
  id: StepId;
  title: string;
  content: ReactNode;
  footer?: ReactNode;
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
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(currentStep);
  useEffect(() => {
    if (!hidden && previousStep.current !== currentStep) {
      heading.current?.focus({ preventScroll: true });
    }
    previousStep.current = currentStep;
  }, [currentStep, hidden]);
  const furthestIndex = steps.findIndex((step) => step.id === furthestStep);

  return (
    <div
      {...props}
      hidden={hidden}
      data-slot="multi-step"
      className={cn(
        "mx-auto w-full min-w-0 max-w-3xl py-6 sm:py-10",
        className,
      )}
    >
      {!hidden && children}
      <div className="mt-8 min-w-0 space-y-7 sm:mt-10">
        {!hidden && (
          <nav aria-label={navigationLabel} className="min-w-0">
            <ol className="grid grid-cols-4">
              {steps.map((step, index) => {
                const confirmed = index < furthestIndex;
                const skipped = confirmed && step.skipped;
                const current = step.id === currentStep;
                return (
                  <li key={step.id} className="relative min-w-0">
                    {index < steps.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute top-5 left-[calc(50%+1.5rem)] right-[calc(-50%+1.5rem)] h-px",
                          index < furthestIndex ? "bg-primary/40" : "bg-border",
                        )}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-full w-full min-w-0 flex-col justify-start gap-3 rounded-lg border-0 px-1 py-0 text-center whitespace-normal hover:bg-transparent disabled:opacity-50"
                      disabled={index > furthestIndex || disabled}
                      aria-current={current ? "step" : undefined}
                      onClick={() => onStepChange(step.id)}
                    >
                      <span
                        className={cn(
                          "relative flex size-10 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                          current
                            ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/10"
                            : confirmed
                              ? "border-primary/30 bg-background text-primary"
                              : "border-border bg-background text-muted-foreground",
                        )}
                      >
                        {confirmed && !skipped && !current ? (
                          <Check className="size-3.5" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="min-w-0 space-y-1">
                        <span
                          className={cn(
                            "block text-xs font-medium sm:text-sm",
                            !current && "text-muted-foreground",
                          )}
                        >
                          {step.title}
                        </span>
                        {skipped && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {skipped}
                          </span>
                        )}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        <div className="min-w-0">
          {steps.map((step, index) => {
            const active = !hidden && step.id === currentStep;
            if (!active && !step.keepMounted) return null;
            const titleId = `${id}-${step.id}`;
            return (
              <Card
                key={step.id}
                hidden={!active}
                role="region"
                aria-labelledby={titleId}
                className="min-w-0 gap-0 rounded-xl border py-0 shadow-sm ring-0"
              >
                <CardHeader className="flex items-center justify-between gap-4 border-b px-5 py-5 sm:px-8 sm:py-6">
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Step {index + 1} of {steps.length}
                    </p>
                    <h2
                      id={titleId}
                      ref={active ? heading : undefined}
                      tabIndex={-1}
                      className="text-xl font-semibold tracking-tight outline-none"
                    >
                      {step.title}
                    </h2>
                  </div>
                  {index > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={disabled}
                      onClick={() => onStepChange(steps[index - 1].id)}
                    >
                      <ArrowLeft data-icon="inline-start" />
                      Back
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="min-w-0 space-y-6 px-5 py-6 sm:px-8 sm:py-7">
                  {step.content}
                </CardContent>
                {step.footer && (
                  <CardFooter className="justify-end gap-3 border-t bg-muted/20 px-5 py-5 sm:px-8">
                    {step.footer}
                  </CardFooter>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
