import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { DISCORD_URL } from "@/constants";

const PRICING_TIERS = [
  {
    name: "Free",
    tagline: "For individuals and small projects getting started.",
    price: "$0",
    priceSuffix: "/ forever",
    cta: "Join the waitlist",
    featured: false,
    features: [
      "Unlimited repositories",
      "Unlimited local telemetry",
      "AI-native CLI and structured APIs",
      "Community support on Discord",
    ],
  },
  {
    name: "Pro",
    tagline: "For teams who ship continuously and need deep signal.",
    price: "$49",
    priceSuffix: "/ month",
    cta: "Join the waitlist",
    featured: true,
    features: [
      "Everything in Free",
      "Premium support",
      "White-glove onboarding",
    ],
  },
];

export function Pricing() {
  return (
    <section className="py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <p className="mb-3 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-fd-muted-foreground/60">
          Pricing
        </p>
        <h2 className="font-heading text-3xl leading-[0.95] sm:text-4xl md:text-5xl lg:text-6xl">
          <span className="relative inline-block px-2 sm:px-3">
            <span className="absolute inset-x-0 bottom-0 top-0 bg-primary" />
            <span className="relative text-primary-foreground ">Simple,</span>
          </span>{" "}
          honest pricing
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
          Start free. Upgrade when you need team and multi-agent collaboration.
        </p>

        <div className="mt-16 grid grid-cols-1 gap-6 md:mt-20 md:grid-cols-2 md:gap-8">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-md border-2 border-fd-border bg-fd-background",
                tier.featured && "border-primary",
              )}
            >
              {tier.featured && (
                <span className="absolute right-6 top-6 rounded-sm bg-primary px-3 py-1 font-heading text-[10px] font-bold uppercase tracking-[0.25em] text-primary-foreground">
                  Recommended
                </span>
              )}

              <div className="border-b-2 border-fd-border p-8 md:p-10">
                <h3 className="font-heading text-2xl font-bold uppercase tracking-wider">
                  {tier.name}
                </h3>
                <p className="mt-3 leading-relaxed text-fd-muted-foreground">
                  {tier.tagline}
                </p>
                <div className="mt-8 flex items-baseline gap-2">
                  <span className="font-heading text-5xl font-bold leading-none md:text-6xl">
                    {tier.price}
                  </span>
                  <span className="font-heading text-xs font-bold uppercase tracking-wider text-fd-muted-foreground">
                    {tier.priceSuffix}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-8 md:p-10">
                <ul className="space-y-3">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 text-[15px] leading-relaxed"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          `mt-0.75 inline-flex size-4 shrink-0 items-center justify-center font-heading text-[11px] font-bold`,
                          tier.featured
                            ? "bg-primary text-primary-foreground"
                            : "bg-fd-secondary text-fd-foreground",
                        )}
                      >
                        &#10003;
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="grow" />
                <div className="mt-10 pt-2">
                  <Button
                    variant={tier.featured ? "cta" : "outline"}
                    size="xl"
                    nativeButton={false}
                    className="w-full"
                    render={
                      <Link
                        to="/waitlist"
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    {tier.cta}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 font-heading text-[11px] uppercase tracking-[0.25em] text-fd-muted-foreground/40">
          Need something custom?{" "}
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fd-foreground underline-offset-4 hover:underline"
          >
            Talk to us on Discord
          </a>
        </p>
      </div>
    </section>
  );
}
