import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "rounded-full border border-transparent px-2 py-0.5 font-medium transition-[color,background-color,border-color,box-shadow] duration-150 ease-out has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 inline-flex items-center justify-center w-fit whitespace-nowrap shrink-0 [&>svg]:pointer-events-none outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-visible:border-ring focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-[3px] aria-invalid:ring-destructive/40 aria-invalid:border-destructive overflow-hidden group/badge",
  {
    variants: {
      size: {
        default: "h-5 gap-1 text-[0.625rem] [&>svg]:size-2.5!",
        // A chip that sits in running text or a table row, at that text's own
        // size and with the row's corner radius rather than a pill's: the
        // glyph and the word are read together with the line.
        md: "gap-1.5 rounded-md text-xs [&>svg]:size-3!",
      },
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
        added: "border-success/40 bg-success/10 text-success",
        changed: "border-warning/40 bg-warning/10 text-warning",
        conflict: "border-ctp-pink/40 bg-ctp-pink/10 text-ctp-pink",
        removed: "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ className, variant, size })),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
      size,
    },
  });
}

export { Badge };
