import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { CookieIcon } from "lucide-react";
import type * as React from "react";

/**
 * A small, always-available way back into consent settings once the
 * initial banner is gone. `ConsentBanner`'s copy promises "you can change
 * your mind at any time"; without a persistent trigger somewhere, that's
 * not actually true. Fixed to the opposite corner from the banner so the
 * two never occupy the same space.
 */
function ConsentTrigger({
  onClick,
  className,
  ...props
}: {
  onClick: () => void;
} & Omit<React.ComponentProps<"button">, "onClick" | "children">) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      onClick={onClick}
      aria-label="Cookie preferences"
      className={cn("fixed bottom-4 left-4 z-40 rounded-full", className)}
      {...props}
    >
      <CookieIcon />
    </Button>
  );
}

export { ConsentTrigger };
