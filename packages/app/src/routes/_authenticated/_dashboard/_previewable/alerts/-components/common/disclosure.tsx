import { CollapsibleTrigger } from "@everr/ui/components/collapsible";
import { cn } from "@everr/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function AlertingDisclosureTrigger({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <CollapsibleTrigger
      className={cn(
        "flex items-center gap-1.5 rounded-md outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 focus-visible:outline-primary",
        "w-full border border-border bg-muted/20 px-3 py-2 text-left hover:bg-muted/40",
        className,
      )}
    >
      <ChevronRight
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
          open && "rotate-90",
        )}
      />
      {children}
    </CollapsibleTrigger>
  );
}
