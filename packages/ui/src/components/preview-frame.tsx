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
import { Separator } from "./separator";

// Controlled: the caller owns `dismissed`; passing `onDismiss` renders the
// dismiss button. Dismissing collapses the bar row (grid 1fr→0fr) rather than
// unmounting it, so the content below rises in sync.
function PreviewFrame({
  variant,
  icon,
  message,
  actions,
  dismissed = false,
  onDismiss,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bannerFrameVariants> & {
    icon?: React.ReactNode;
    message?: React.ReactNode;
    actions?: React.ReactNode;
    dismissed?: boolean;
    onDismiss?: () => void;
  }) {
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
              <BannerContent className="flex-initial truncate">{message}</BannerContent>
            </div>
            {(actions || onDismiss) && (
              <BannerActions className="gap-0.5">
                {actions}
                {actions && onDismiss && <Separator orientation="vertical" />}
                {onDismiss && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Dismiss"
                    title="Dismiss"
                    className="opacity-70 hover:opacity-100"
                    onClick={onDismiss}
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
