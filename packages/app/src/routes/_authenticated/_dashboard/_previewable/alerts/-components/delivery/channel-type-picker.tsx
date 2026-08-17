import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  CHANNEL_TAGLINE,
  type ChannelType,
} from "./channel-meta";

const CHANNEL_TYPES = Object.keys(CHANNEL_LABEL) as ChannelType[];

const TILE_CLASS =
  "flex min-h-16 w-full flex-col items-start gap-1 rounded-md border border-border bg-muted/20 p-2.5 text-left transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-muted/50";

function TileBody({ type }: { type: ChannelType }) {
  const Icon = CHANNEL_ICON[type];
  return (
    <>
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="text-xs font-medium text-foreground">
          {CHANNEL_LABEL[type]}
        </span>
      </span>
      <span className="text-[0.6875rem] leading-snug text-muted-foreground">
        {CHANNEL_TAGLINE[type]}
      </span>
    </>
  );
}

// A container query, not a viewport one: the same grid sits in a 30rem drawer
// and in the full-width guide, and only its own width decides how many tiles
// fit on a line.
function TileGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">{children}</div>
    </div>
  );
}

/**
 * The type choice inside the channel builder.
 *
 * Native radios (visually hidden) rather than buttons with `aria-checked`: the
 * group then arrows between options and reports itself as one choice, which is
 * what it is.
 */
export function ChannelTypeChoice({
  value,
  onChange,
  legend,
}: {
  value: ChannelType | null;
  onChange: (type: ChannelType) => void;
  legend: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium">{legend}</legend>
      <TileGrid>
        {CHANNEL_TYPES.map((type) => (
          <label
            key={type}
            className={cn(
              TILE_CLASS,
              "cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-primary has-focus-visible:outline-offset-2",
              value === type && "border-primary/60 bg-primary/10",
            )}
          >
            <input
              type="radio"
              name="channel-type"
              className="sr-only"
              checked={value === type}
              onChange={() => onChange(type)}
            />
            <TileBody type={type} />
          </label>
        ))}
      </TileGrid>
    </fieldset>
  );
}

/** The same tiles as the way into an empty setup: each one starts a channel. */
export function ChannelTypeLauncher({
  onPick,
  labelPrefix,
}: {
  onPick: (type: ChannelType) => void;
  labelPrefix: string;
}) {
  return (
    <TileGrid>
      {CHANNEL_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          aria-label={`${labelPrefix} ${CHANNEL_LABEL[type]}`}
          onClick={() => onPick(type)}
          className={cn(
            TILE_CLASS,
            "outline-2 outline-dotted outline-transparent outline-offset-2 hover:border-primary/60 focus-visible:outline-primary",
          )}
        >
          <TileBody type={type} />
        </button>
      ))}
    </TileGrid>
  );
}
