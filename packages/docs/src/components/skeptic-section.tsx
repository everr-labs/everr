import { ArrowUpRight } from "lucide-react";

export function SkepticSection() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-9 text-foreground sm:py-12">
      <div className="grid items-center gap-4 rounded-xl bg-primary px-6 py-7 text-primary-foreground min-[700px]:grid-cols-2 min-[700px]:gap-16 min-[700px]:px-10 min-[700px]:py-8">
        <h2 className="text-balance text-[clamp(24px,2.5vw,32px)] leading-tight tracking-[-0.025em]">
          Still don't believe it can be that simple?
        </h2>
        <div>
          <p className="text-[15px] leading-relaxed text-primary-foreground/80">
            If the effort feels bigger than the payoff, start here.
          </p>
          <a
            className="mt-3 inline-flex items-center gap-3 text-[15px] font-medium text-primary-foreground rounded-sm focus-visible:outline-2 focus-visible:outline-offset-6 focus-visible:outline-primary-foreground [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:translate-x-0.5 hover:[&_svg]:-translate-y-0.5 motion-reduce:[&_svg]:transition-none"
            href="/why-observability"
          >
            A case for the skeptics
            <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
