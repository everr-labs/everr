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
      // A flex column is what lets the viewport track the root's height in
      // every sizing shape. Base UI forces `overflow: scroll` inline on the
      // viewport, so a percentage height there resolves against whichever
      // ancestor is definite and the root silently clips instead of scrolling.
      className={cn("relative flex flex-col overflow-hidden", className)}
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
        "w-full min-h-0 flex-1 rounded-[inherit] focus-visible:outline-none",
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
        "data-scrolling:opacity-100",
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
  viewportProps?: ScrollAreaPrimitive.Viewport.Props &
    Record<`data-${string}`, string>;
  orientation?: "vertical" | "horizontal" | "both";
}

function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportRef,
  // ref and className are pulled through their own dedicated props above, so
  // a caller passing viewportProps can never clobber either.
  viewportProps: {
    ref: _ignoredRef,
    className: _ignoredClassName,
    ...viewportProps
  } = {},
  orientation = "vertical",
  ...props
}: ScrollAreaProps) {
  const vertical = orientation === "vertical" || orientation === "both";
  const horizontal = orientation === "horizontal" || orientation === "both";
  return (
    <ScrollAreaRoot data-slot="scroll-area" className={className} {...props}>
      <ScrollAreaViewport
        ref={viewportRef}
        className={viewportClassName}
        {...viewportProps}
      >
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

interface ScrollAreaScrollerProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
  // Virtuoso passes its `context` value to every custom component. It is not a
  // DOM attribute, so it is dropped here instead of reaching the viewport.
  context?: unknown;
}

// react-virtuoso attaches its scroll listener, and reads scrollTop,
// scrollHeight and offsetHeight, on whatever element it gets this ref for, so
// the ref has to land on the real scrolling element (the viewport) and never on
// the root. Everything else virtuoso passes (tabIndex, data-virtuoso-scroller,
// data-testid, the inline style) goes to the same element.
function ScrollAreaScroller({
  ref,
  children,
  className,
  style,
  context: _context,
  ...props
}: ScrollAreaScrollerProps) {
  // Virtuoso's own overflow keys are dropped: Base UI already writes
  // `overflow: scroll` inline on the viewport, and a second axis-specific value
  // merged on top would fight it. `position: relative` is kept because the
  // virtuoso item list is absolutely positioned against the scroller.
  const {
    overflowY: _y,
    overflowX: _x,
    overflow: _o,
    ...scrollerStyle
  } = style ?? {};
  return (
    <ScrollArea
      className={className}
      viewportRef={ref}
      viewportProps={{ ...props, style: scrollerStyle }}
    >
      {children}
    </ScrollArea>
  );
}

export {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaScroller,
  ScrollAreaThumb,
  ScrollAreaViewport,
};
