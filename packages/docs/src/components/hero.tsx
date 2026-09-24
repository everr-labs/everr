import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12 min-[701px]:py-20">
        <p className="mb-7 text-lg font-medium leading-[1.4]">
          Observability made simple.
        </p>
        <h1 className="max-w-[1200px] text-balance text-[clamp(40px,9vw,58px)] font-[550] leading-[1.02] tracking-[-0.04em] min-[701px]:text-[clamp(42px,6.5vw,88px)]">
          Understand what your app is doing{" "}
          <span className="mt-3 block text-primary">
            in minutes, not months
            <span className="ml-[0.04em] inline-block align-super text-[0.62em] leading-none">
              *
            </span>
          </span>
        </h1>
        <p className="mt-[18px] flex items-center gap-3 text-base leading-[1.35] text-muted-foreground min-[701px]:text-base">
          <span
            className="translate-y-1.5 text-[28px] leading-[0.7] text-primary"
            aria-hidden="true"
          >
            *
          </span>
          No observability team required
        </p>
        <div className="mt-8 flex flex-col items-start gap-6 border-t border-border py-6 min-[701px]:flex-row min-[701px]:items-center min-[701px]:justify-between min-[701px]:gap-8">
          <p className="max-w-[65ch] flex-1 text-[17px] leading-[1.6] text-muted-foreground">
            Everr turns established observability practices into guided
            workflows, from AI-assisted setup to everyday monitoring and
            investigation.
            <br />
            Focus shipping features, not hunting down issues.
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5 min-[701px]:gap-3 [&_[data-slot=button]]:h-[50px] [&_[data-slot=button]]:px-[18px] [&_[data-slot=button]]:text-base min-[701px]:[&_[data-slot=button]]:px-6 [&_[data-slot=button]]:focus-visible:outline-2 [&_[data-slot=button]]:focus-visible:outline-offset-[5px]">
            <Button
              variant="default"
              size="xl"
              nativeButton={false}
              // biome-ignore lint/a11y/useAnchorContent: content is injected by Button
              render={<a href="https://app.everr.dev/auth/sign-up" />}
            >
              Get started
            </Button>
            <Button
              variant="secondary"
              size="xl"
              nativeButton={false}
              render={<Link to="/docs/$" params={{ _splat: "" }} />}
            >
              See how Everr works
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
