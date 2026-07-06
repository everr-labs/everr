// packages/app/src/components/cc/help-tip.tsx
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { CircleHelp } from "lucide-react";

// A tiny contextual-help affordance: a `?` icon button that reveals one plain
// sentence in a popover. Popover (not Tooltip) so the explanation is reachable
// by click/tap as well as keyboard (Enter/Space opens, Escape closes) without
// relying on hover, which touch devices and keyboard-only users don't have.
export function HelpTip({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Help"
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          />
        }
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 text-xs leading-relaxed">
        {text}
      </PopoverContent>
    </Popover>
  );
}
