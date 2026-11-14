import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "@everr/ui/lib/utils";

/**
 * A panel that slides up from the bottom of a phone screen and goes away with
 * a swipe down, a tap on the dimmed page above it, Escape, or a `DrawerClose`.
 * Scrollable content inside keeps scrolling: the swipe only takes over once
 * it is scrolled to the top.
 */
function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

// Follows the finger while dragging (no transition then), and eases in and
// out on the curve the platform sheets use.
const DRAWER_EASE = "duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0";

function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Backdrop
        data-slot="drawer-overlay"
        className={cn(
          // Fades with the drag, so the page comes back as the drawer goes.
          "fixed inset-0 z-50 bg-black/80 opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0",
          DRAWER_EASE,
        )}
      />
      {/* Clicks pass through to the backdrop, which closes the drawer; the
          viewport still gets the drag, which bubbles up from the popup. */}
      <DrawerPrimitive.Viewport className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center">
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "bg-background pointer-events-auto relative flex w-full flex-col rounded-t-xl border-t pb-[env(safe-area-inset-bottom)] text-xs/relaxed shadow-lg outline-hidden",
            "translate-y-(--drawer-swipe-movement-y) transition-transform data-starting-style:translate-y-full data-ending-style:translate-y-full",
            DRAWER_EASE,
            className,
          )}
          {...props}
        >
          {/* The grab handle: says the panel can be swiped down. */}
          <div
            aria-hidden="true"
            className="bg-muted-foreground/30 mx-auto mt-2 h-1 w-10 shrink-0 rounded-full"
          />
          {children}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-foreground text-sm font-medium", className)}
      {...props}
    />
  );
}

export { Drawer, DrawerClose, DrawerContent, DrawerTitle };
