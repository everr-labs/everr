import { ScrollArea } from "@everr/ui/components/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * Preformatted text in a box that scrolls both ways. The `<pre>` no longer owns
 * the scroll, so the box is what bounds the height, and long lines keep running
 * off the side instead of wrapping.
 */
export function CodeBlock({
  className,
  codeClassName,
  children,
}: {
  /** The box: its height bound, background and border. */
  className?: string;
  /** The text: its padding, size and colour. */
  codeClassName?: string;
  children: ReactNode;
}) {
  return (
    <ScrollArea orientation="both" className={className}>
      <pre className={cn("p-3 text-xs leading-relaxed", codeClassName)}>
        {children}
      </pre>
    </ScrollArea>
  );
}
