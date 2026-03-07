import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit items-center justify-center rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold tracking-[0.02em]",
  {
    variants: {
      variant: {
        default: "border-white bg-white text-black",
        secondary: "border-white/10 bg-white/[0.08] text-white",
        outline: "border-white/12 bg-transparent text-white/72",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
