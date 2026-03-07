import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium outline-none transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-white/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "border border-white bg-white text-black hover:bg-white/90",
        outline:
          "border border-white/12 bg-white/[0.05] text-white hover:bg-white/[0.1]",
        ghost: "border border-transparent bg-transparent text-white hover:bg-white/[0.08]",
      },
      size: {
        default: "h-10 px-4 py-2 font-semibold",
        sm: "h-8 rounded-lg px-3 text-xs font-semibold",
        icon: "size-8 rounded-lg p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
