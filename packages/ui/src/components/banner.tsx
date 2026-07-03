import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

export type BannerVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

const VARIANTS = {
  neutral: { surface: "text-muted-foreground", ring: "ring-border" },
  info: { surface: "bg-sky-500 text-foreground", ring: "ring-sky-500" },
  success: {
    surface: "bg-emerald-500 text-emerald-300",
    ring: "ring-emerald-500",
  },
  warning: {
    surface: "bg-amber-500 text-amber-300",
    ring: "ring-amber-500",
  },
  danger: { surface: "bg-red-500 text-red-300", ring: "ring-red-500" },
} satisfies Record<BannerVariant, { surface: string; ring: string }>;

const byVariant = (key: "surface" | "ring"): Record<BannerVariant, string> =>
  Object.fromEntries(
    Object.entries(VARIANTS).map(([variant, tone]) => [variant, tone[key]]),
  ) as Record<BannerVariant, string>;

const bannerVariants = cva("flex items-center gap-2 text-sm", {
  variants: { variant: byVariant("surface") },
  defaultVariants: { variant: "neutral" },
});

const bannerFrameVariants = cva(
  "flex min-h-0 flex-1 flex-col ring-2 ring-inset",
  {
    variants: { variant: byVariant("ring") },
    defaultVariants: { variant: "neutral" },
  },
);

function Banner({
  className,
  variant,
  role = "status",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof bannerVariants>) {
  return (
    <div
      data-slot="banner"
      role={role}
      className={cn(bannerVariants({ variant, className }))}
      {...props}
    />
  );
}

function BannerContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-content"
      className={cn("min-w-0 flex-1", className)}
      {...props}
    />
  );
}

function BannerActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="banner-actions"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

export {
  Banner,
  BannerActions,
  BannerContent,
  bannerFrameVariants,
  bannerVariants,
};
