import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "h-5 gap-1 rounded-full border border-transparent px-2 py-0.5 text-[0.625rem] font-medium transition-all duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-2.5! inline-flex items-center justify-center w-fit whitespace-nowrap shrink-0 [&>svg]:pointer-events-none outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-visible:border-ring focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-[3px] aria-invalid:ring-destructive/40 aria-invalid:border-destructive overflow-hidden group/badge",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/20 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/40 text-destructive",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground bg-input/30",
        ghost: "hover:bg-muted/50 hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Diff/status tones (e.g. the preview overlay). 400-shade text on a
        // faint tinted fill reads legibly on the app's near-black surfaces.
        added: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        changed: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        conflict: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-400",
        removed: "border-red-500/40 bg-red-500/10 text-red-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ className, variant })),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge };
