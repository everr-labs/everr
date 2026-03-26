import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "@everr/ui/lib/utils";
import type * as React from "react";

function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black",
        "transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  side = "right",
  ...props
}: DrawerPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className={cn(
          "fixed inset-0 z-50 flex",
          side === "bottom" && "items-end justify-center",
          side === "top" && "items-start justify-center",
          side === "left" && "items-stretch justify-start",
          side === "right" && "items-stretch justify-end",
        )}
      >
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          data-side={side}
          className={cn(
            "bg-background text-foreground flex flex-col outline-none",
            "overflow-y-auto overscroll-contain touch-auto",
            "transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform",
            "data-[swiping]:select-none data-[swiping]:transition-none",
            "data-[ending-style]:duration-[calc(var(--drawer-swipe-strength)*400ms)]",
            "group/drawer-content",
            side === "bottom" &&
              "border-border inset-x-0 bottom-0 mt-24 max-h-[80vh] w-full rounded-t-xl border-t shadow-lg [transform:translateY(var(--drawer-swipe-movement-y))] data-[starting-style]:[transform:translateY(100%)] data-[ending-style]:[transform:translateY(100%)]",
            side === "top" &&
              "border-border inset-x-0 top-0 mb-24 max-h-[80vh] w-full rounded-b-xl border-b shadow-lg [transform:translateY(var(--drawer-swipe-movement-y))] data-[starting-style]:[transform:translateY(-100%)] data-[ending-style]:[transform:translateY(-100%)]",
            side === "left" &&
              "border-border inset-y-0 left-0 h-full w-3/4 border-r shadow-lg sm:max-w-sm [transform:translateX(var(--drawer-swipe-movement-x))] data-[starting-style]:[transform:translateX(-100%)] data-[ending-style]:[transform:translateX(-100%)]",
            side === "right" &&
              "border-border inset-y-0 right-0 h-full w-3/4 border-l shadow-lg sm:max-w-sm [transform:translateX(var(--drawer-swipe-movement-x))] data-[starting-style]:[transform:translateX(100%)] data-[ending-style]:[transform:translateX(100%)]",
            className,
          )}
          {...props}
        >
          {(side === "bottom" || side === "top") && (
            <div className="bg-muted mx-auto mt-3 mb-1 h-1.5 w-[100px] shrink-0 rounded-full" />
          )}
          <DrawerPrimitive.Content
            data-slot="drawer-inner-content"
            className="mx-auto w-full max-w-lg"
          >
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-6", className)}
      {...props}
    />
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

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground text-xs/relaxed", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
