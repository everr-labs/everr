import { cva, type VariantProps } from "class-variance-authority";
import { Citrus } from "lucide-react";
import { cn } from "../lib/utils";

const everrLogoVariants = cva(
  "inline-flex items-center font-heading font-semibold [&>svg]:text-primary",
  {
    variants: {
      size: {
        default: "gap-1.5 [&>svg]:size-5",
        lg: "gap-2 text-2xl [&>svg]:size-8",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

type EverrLogoProps = VariantProps<typeof everrLogoVariants> & {
  className?: string;
};

export function EverrLogo({ className, size = "default" }: EverrLogoProps) {
  return (
    <span className={cn(everrLogoVariants({ size, className }))}>
      <Citrus aria-hidden="true" />
      Everr
    </span>
  );
}
