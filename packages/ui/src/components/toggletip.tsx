import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@everr/ui/lib/utils";
import { useId } from "react";
import { TOOLTIP_DELAY_MS } from "@everr/ui/components/tooltip";

/**
 * A tooltip that also opens on tap, for hints a reader may need on a touch
 * screen (a plain tooltip never opens there). Hover opens it with a pointer,
 * a press toggles it everywhere; it looks like a tooltip either way.
 */
function Toggletip({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="toggletip" {...props} />;
}

function ToggletipTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="toggletip-trigger"
      openOnHover
      delay={TOOLTIP_DELAY_MS}
      closeDelay={0}
      {...props}
    />
  );
}

function ToggletipContent({
  className,
  children,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const textId = useId();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="toggletip-content"
          // A hint, not a dialog: focus stays on the trigger. Base UI still
          // gives the popup a dialog role, so its own text names it.
          initialFocus={false}
          aria-labelledby={textId}
          className={cn(
            "motion-popup bg-foreground shadow-[0_4px_16px_-4px_oklch(0_0_0/50%)] text-background z-50 w-fit max-w-[min(20rem,calc(100vw-1rem))] origin-(--transform-origin) rounded-md px-3 py-1.5 text-xs outline-hidden",
            className,
          )}
          {...props}
        >
          <div id={textId}>{children}</div>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Toggletip, ToggletipContent, ToggletipTrigger };
