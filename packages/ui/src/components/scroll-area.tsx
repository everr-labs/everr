import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import type * as React from "react";

function ScrollAreaViewport({
  className,
  ...props
}: ScrollAreaPrimitive.Viewport.Props) {
  return (
    <ScrollAreaPrimitive.Viewport
      data-slot="scroll-area-viewport"
      className={cn(
        "min-h-0 flex-1 rounded-[inherit] focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

function ScrollAreaScrollbar({
  orientation,
}: {
  orientation: "vertical" | "horizontal";
}) {
  return (
    // Not keepMounted: Base UI unmounts the bar when the axis does not
    // overflow, and every mounted bar costs a getComputedStyle on every scroll
    // event, whether or not it has anything to show.
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "z-20 flex touch-none select-none p-0.5 opacity-0 transition-opacity duration-150",
        "data-scrolling:opacity-100",
        orientation === "vertical" ? "h-full w-2.5" : "h-2.5 w-full flex-col",
      )}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="bg-scrollbar-thumb flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

// Base UI's Root writes role="presentation". That is a no-op on the default
// div, but on a semantic `render` element it strips the landmark, so <main>,
// <nav> and <aside> roots stop being addressable. Clearing it restores them; a
// caller's own role still wins, because its props are spread afterwards.
const clearPresentationRole = { role: undefined };

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
    style: viewportStyle,
    ...viewportProps
  } = {},
  orientation = "vertical",
  ...props
}: ScrollAreaProps) {
  const vertical = orientation === "vertical" || orientation === "both";
  const horizontal = orientation === "horizontal" || orientation === "both";
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      // A flex column is what lets the viewport track the root's height in
      // every sizing shape. Base UI forces `overflow: scroll` inline on the
      // viewport, so a percentage height there resolves against whichever
      // ancestor is definite and the root silently clips instead of scrolling.
      className={cn("flex flex-col overflow-hidden", className)}
      {...clearPresentationRole}
      {...props}
    >
      <ScrollAreaViewport
        ref={viewportRef}
        className={viewportClassName}
        // Base UI writes `overflow: scroll` on both axes, so the axis this
        // scroll area does not own has to be clipped back inline. Without it
        // an `orientation="vertical"` area still scrolls sideways, with no
        // scrollbar to show for it.
        style={{
          ...(horizontal ? undefined : { overflowX: "hidden" as const }),
          ...(vertical ? undefined : { overflowY: "hidden" as const }),
          ...viewportStyle,
        }}
        {...viewportProps}
      >
        {children}
      </ScrollAreaViewport>
      {vertical && <ScrollAreaScrollbar orientation="vertical" />}
      {horizontal && <ScrollAreaScrollbar orientation="horizontal" />}
      {/* No Corner: it only reserves the square where the two bars meet, which
          overlay bars do not need, and mounting one makes Base UI write a fresh
          corner size into state on every scroll event, re-rendering the whole
          scroll area with it. */}
    </ScrollAreaPrimitive.Root>
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
  // Virtuoso's own overflow keys are dropped: the scroll area already sets
  // overflow on both axes, and a value merged on top would fight it.
  // `position: relative` is kept because the virtuoso item list is absolutely
  // positioned against the scroller.
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

// Virtuoso remounts its scroller, losing the scroll position, whenever the
// `components` map hands it a new component identity. Sharing this one object
// keeps every list on the same stable identity, with no memoisation per list.
const virtuosoScrollAreaComponents = { Scroller: ScrollAreaScroller };

export { ScrollArea, ScrollAreaScroller, virtuosoScrollAreaComponents };
