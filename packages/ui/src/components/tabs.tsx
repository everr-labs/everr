import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("gap-2 group/tabs flex data-[orientation=horizontal]:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "relative isolate rounded-lg p-[3px] group-data-horizontal/tabs:h-8 data-[variant=line]:rounded-none group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-white/[0.035] shadow-[inset_0_0_0_1px_oklch(1_0_0/5%)]",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        // Positioned from the active tab's box, which Base UI exposes as CSS
        // variables. Moving it with `translate` keeps the glide on the
        // compositor. The first placement has no previous tab to come from,
        // so `data-[activation-direction=none]` skips the transition.
        className={cn(
          "pointer-events-none absolute top-0 left-0 translate-x-(--active-tab-left) translate-y-(--active-tab-top) transition-[translate,width,height] duration-250 ease-(--ease-out) data-[activation-direction=none]:transition-none motion-reduce:transition-none",
          variant === "line"
            ? "group-data-[orientation=horizontal]/tabs:mt-[calc(var(--active-tab-height)+4px)] group-data-[orientation=horizontal]/tabs:h-0.5 group-data-[orientation=horizontal]/tabs:w-(--active-tab-width) group-data-[orientation=vertical]/tabs:ml-[calc(var(--active-tab-width)+3px)] group-data-[orientation=vertical]/tabs:h-(--active-tab-height) group-data-[orientation=vertical]/tabs:w-0.5 bg-foreground rounded-full"
            : "h-(--active-tab-height) w-(--active-tab-width) rounded-md bg-white/[0.08] shadow-[inset_0_1px_0_0_oklch(1_0_0/6%),0_1px_2px_0_oklch(0_0_0/30%)]",
        )}
      />
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium group-data-vertical/tabs:py-[calc(--spacing(1.25))] [&_svg:not([class*='size-'])]:size-3.5 outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-visible:ring-primary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-offset-[3px] text-muted-foreground hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center whitespace-nowrap transition-[color,outline,outline-offset,box-shadow] duration-150 ease-out group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:border-transparent",
        "z-10 data-active:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("text-xs/relaxed flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
