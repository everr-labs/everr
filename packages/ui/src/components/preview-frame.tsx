import {
  Banner,
  BannerActions,
  BannerContent,
  bannerFrameVariants,
} from "@everr/ui/components/banner";
import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

function PreviewFrame({
  variant,
  icon,
  message,
  actions,
  dismissible = false,
  onDismiss,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bannerFrameVariants> & {
    icon?: React.ReactNode;
    message?: React.ReactNode;
    actions?: React.ReactNode;
    dismissible?: boolean;
    onDismiss?: () => void;
  }) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <div className={cn(bannerFrameVariants({ variant }), className)} {...props}>
      <div
        className="grid shrink-0 transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: dismissed ? "0fr" : "1fr" }}
      >
        <div className="overflow-hidden" inert={dismissed || undefined}>
          <Banner
            variant={variant}
            aria-hidden={dismissed || undefined}
            className="flex w-full items-center justify-between py-1 pl-3.5 pr-1.5"
          >
            <div className="flex min-w-0 items-center gap-2">
              {icon}
              <BannerContent className="flex-initial truncate">
                {message}
              </BannerContent>
            </div>
            {(actions || dismissible) && (
              <BannerActions className="gap-0.5">
                {actions}
                {actions && dismissible && (
                  // A hairline splits caller actions from the built-in dismiss.
                  <span
                    aria-hidden
                    className="mx-0.5 h-4 w-px shrink-0 bg-current opacity-20"
                  />
                )}
                {dismissible && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Dismiss"
                    title="Dismiss"
                    className="opacity-70 hover:opacity-100"
                    onClick={() => {
                      setDismissed(true);
                      onDismiss?.();
                    }}
                  >
                    <X />
                  </Button>
                )}
              </BannerActions>
            )}
          </Banner>
        </div>
      </div>
      {children}
    </div>
  );
}

export { PreviewFrame };
