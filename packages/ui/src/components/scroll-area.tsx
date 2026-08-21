import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import type * as React from "react";

function ScrollAreaRoot({
  className,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area-root"
      className={cn("relative overflow-hidden", className)}
      {...props}
    />
  );
}

function ScrollAreaViewport({
  className,
  ...props
}: ScrollAreaPrimitive.Viewport.Props) {
  return (
    <ScrollAreaPrimitive.Viewport
      data-slot="scroll-area-viewport"
      className={cn(
        "size-full rounded-[inherit] focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

function ScrollAreaContent({
  className,
  ...props
}: ScrollAreaPrimitive.Content.Props) {
  return (
    <ScrollAreaPrimitive.Content
      data-slot="scroll-area-content"
      className={className}
      {...props}
    />
  );
}

function ScrollAreaScrollbar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "z-20 flex touch-none select-none p-0.5 opacity-0 transition-opacity duration-150",
        "data-hovering:opacity-100 data-scrolling:opacity-100",
        orientation === "vertical" && "h-full w-2.5",
        orientation === "horizontal" && "w-full flex-col h-2.5",
        className,
      )}
      {...props}
    />
  );
}

function ScrollAreaThumb({
  className,
  ...props
}: ScrollAreaPrimitive.Thumb.Props) {
  return (
    <ScrollAreaPrimitive.Thumb
      data-slot="scroll-area-thumb"
      className={cn(
        "bg-(--scrollbar-thumb) hover:bg-(--scrollbar-thumb-hover) flex-1 rounded-full transition-colors",
        className,
      )}
      {...props}
    />
  );
}

function ScrollAreaCorner({
  className,
  ...props
}: ScrollAreaPrimitive.Corner.Props) {
  return (
    <ScrollAreaPrimitive.Corner
      data-slot="scroll-area-corner"
      className={cn("bg-transparent", className)}
      {...props}
    />
  );
}

interface ScrollAreaProps extends ScrollAreaPrimitive.Root.Props {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  orientation?: "vertical" | "horizontal" | "both";
}

function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportRef,
  orientation = "vertical",
  ...props
}: ScrollAreaProps) {
  const vertical = orientation === "vertical" || orientation === "both";
  const horizontal = orientation === "horizontal" || orientation === "both";
  return (
    <ScrollAreaRoot data-slot="scroll-area" className={className} {...props}>
      <ScrollAreaViewport ref={viewportRef} className={viewportClassName}>
        {children}
      </ScrollAreaViewport>
      {vertical && (
        <ScrollAreaScrollbar orientation="vertical" keepMounted>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      )}
      {horizontal && (
        <ScrollAreaScrollbar orientation="horizontal" keepMounted>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      )}
      {orientation === "both" && <ScrollAreaCorner />}
    </ScrollAreaRoot>
  );
}

export {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
};
