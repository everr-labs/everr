import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@everr/ui/lib/utils";
import { useId } from "react";

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
      delay={0}
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
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 bg-foreground text-background z-50 w-fit max-w-[min(20rem,calc(100vw-1rem))] origin-(--transform-origin) rounded-md px-3 py-1.5 text-xs outline-hidden",
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
