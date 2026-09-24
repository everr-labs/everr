import { Marquee } from "@/components/ui/marquee";

type Capability = { label: string; planned: boolean };

export function CapabilityMarquee({ features }: { features: Capability[] }) {
  const midpoint = Math.ceil(features.length / 2);
  const rows = [features.slice(0, midpoint), features.slice(midpoint)];

  return (
    <div className="grid gap-6 motion-safe:[mask-image:linear-gradient(90deg,transparent,#000_5%,#000_95%,transparent)] motion-reduce:px-6">
      {rows.map((row, index) => (
        <Marquee
          className="p-0 [--duration:140s] [--gap:32px] motion-reduce:[&>div]:w-full motion-reduce:[&>div]:min-w-0 motion-reduce:[&>div]:shrink motion-reduce:[&>div]:animate-none motion-reduce:[&>div]:transform-none motion-reduce:[&>div[aria-hidden=true]]:hidden"
          key={row[0].label}
          reverse={index === 1}
          pauseOnHover
          repeat={2}
        >
          <ul className="flex list-none items-center gap-8 p-0 motion-reduce:flex-wrap motion-reduce:justify-center">
            {row.map(({ label, planned }) => (
              <li
                key={label}
                className="flex shrink-0 items-center gap-2.5 whitespace-nowrap px-3 py-2 text-xl leading-[1.3] tracking-[-0.02em] text-muted-foreground sm:text-2xl motion-reduce:max-w-full motion-reduce:flex-wrap motion-reduce:whitespace-normal motion-reduce:text-[22px]"
              >
                <span
                  className={planned ? "text-muted-foreground/85" : undefined}
                >
                  {label}
                </span>
                {planned && (
                  <small className="inline-flex shrink-0 items-center rounded-full border border-border bg-card px-2 py-[3px] text-xs font-medium leading-[1.4] tracking-[0.01em] text-muted-foreground">
                    Planned
                  </small>
                )}
              </li>
            ))}
          </ul>
        </Marquee>
      ))}
    </div>
  );
}
