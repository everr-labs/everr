import { Card, CardContent } from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Sparkline } from "@everr/ui/components/sparkline";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function StatSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
        {label}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/** An undefined `value` renders the loading skeleton. */
export function StatTile({
  label,
  to,
  value,
  series,
  color,
}: {
  label: string;
  to: LinkProps["to"];
  value: string | undefined;
  series?: number[];
  color?: string;
}) {
  return (
    <Link to={to} className="block h-full">
      <Card className="group relative h-full gap-2 overflow-hidden py-4 transition-colors hover:bg-muted/30">
        {series?.some((v) => v > 0) && (
          <Sparkline
            data={series}
            color={color}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 opacity-20 transition-opacity group-hover:opacity-35"
          />
        )}
        <CardContent className="relative space-y-1 px-4">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              {label}
            </p>
            <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          {value === undefined ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums leading-8">
              {value}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
