import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const toggleVariants = cva(
  "hover:text-foreground aria-pressed:bg-muted outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-visible:ring-primary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-offset-[3px] aria-invalid:ring-destructive/40 aria-invalid:border-destructive data-[state=on]:bg-muted gap-1 rounded-md text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] [&_svg:not([class*='size-'])]:size-3.5 group/toggle hover:bg-muted inline-flex items-center justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-input hover:bg-muted border bg-transparent",
      },
      size: {
        default: "h-7 min-w-7 px-2",
        sm: "h-6 min-w-6 rounded-[min(var(--radius-md),8px)] px-1.5 text-[0.625rem] [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 min-w-8 px-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
