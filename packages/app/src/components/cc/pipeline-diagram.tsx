import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  type LucideIcon,
  Send,
  Waypoints,
  Zap,
} from "lucide-react";

function plural(n: number, one: string, many = `${one}s`) {
  return n === 1 ? one : many;
}

function Stage({
  icon: Icon,
  title,
  sub,
  live,
  to,
  hash,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  live?: boolean;
  to: "/alerts/triage" | "/alerts/routing";
  hash?: string;
}) {
  return (
    <Link
      to={to}
      hash={hash}
      className="group/stage flex-1 rounded-md border border-border bg-muted/20 p-3 outline-2 outline-dotted outline-transparent outline-offset-2 transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-muted/40 focus-visible:outline-primary"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover/stage:text-foreground">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div
            className={cn(
              "truncate text-xs tabular-nums",
              live ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {sub}
          </div>
        </div>
      </div>
    </Link>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-muted-foreground/40 md:px-0.5">
      <ChevronRight className="hidden size-4 md:block" />
      <ChevronDown className="size-4 md:hidden" />
    </div>
  );
}

export function CcPipelineDiagram({
  firing,
  routeCount,
  receiverCount,
  silenceCount,
  inhibitionCount,
}: {
  firing: number;
  routeCount: number;
  receiverCount: number;
  silenceCount: number;
  inhibitionCount: number;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
        <Stage
          icon={Zap}
          title="Alert fires"
          sub={`${firing} firing now`}
          live={firing > 0}
          to="/alerts/triage"
        />
        <Arrow />
        <Stage
          icon={Waypoints}
          title="Matched by route"
          sub={`${routeCount} ${plural(routeCount, "route")} · first match wins`}
          to="/alerts/routing"
          hash="routes"
        />
        <Arrow />
        <Stage
          icon={Send}
          title="Delivered"
          sub={`${receiverCount} ${plural(receiverCount, "receiver")}`}
          to="/alerts/routing"
          hash="receivers"
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Alerts matching no route fall through to the{" "}
        <Link
          to="/alerts/routing"
          hash="firehose"
          className="text-foreground underline-offset-2 hover:underline"
        >
          firehose
        </Link>
        .
        {silenceCount > 0 &&
          ` ${silenceCount} active ${plural(silenceCount, "silence")} apply to matching alerts.`}
        {inhibitionCount > 0 &&
          ` ${inhibitionCount} ${plural(inhibitionCount, "inhibition")} can suppress downstream alerts.`}
      </p>
    </div>
  );
}
