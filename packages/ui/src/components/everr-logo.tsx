import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
import { everrLogoPaths } from "./everr-logo-paths";

const everrLogoVariants = cva(
  "inline-flex font-heading font-semibold [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        monochrome: "[&>svg]:text-primary",
        default: "",
      },
      size: {
        default: "gap-0.5 [&>svg]:size-5",
        lg: "gap-0.5 text-3xl [&>svg]:size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type EverrLogoProps = VariantProps<typeof everrLogoVariants> & {
  className?: string;
};

export function EverrLogo({
  className,
  size = "default",
  variant = "default",
}: EverrLogoProps) {
  return (
    <span className={cn(everrLogoVariants({ size, variant, className }))}>
      <EverrLogoMark variant={variant ?? "default"} aria-hidden="true" />
      everr
    </span>
  );
}

type EverrLogoMarkProps = ComponentProps<"svg"> & {
  variant?: NonNullable<VariantProps<typeof everrLogoVariants>["variant"]>;
};

export function EverrLogoMark({
  variant = "default",
  ...props
}: EverrLogoMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 657 657"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      strokeLinejoin="round"
      strokeMiterlimit={2}
      aria-hidden="true"
      {...props}
    >
      <path d={everrLogoPaths.body} />
      <path d={everrLogoPaths.antenna} />
      <path
        fill={variant === "default" ? "var(--primary)" : "currentColor"}
        d={
          everrLogoPaths.rays + everrLogoPaths.rightEye + everrLogoPaths.leftEye
        }
      />
    </svg>
  );
}
