import { SiDiscord, SiGithub, SiX } from "@icons-pack/react-simple-icons";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Citrus } from "lucide-react";
import { DISCORD_URL } from "@/constants";

export function Footer() {
  return (
    <footer className="border-t border-fd-border">
      <div className="w-full">
        <section className="relative overflow-hidden bg-primary text-primary-foreground selection:bg-primary-foreground selection:text-primary">
          <SiDiscord
            className="pointer-events-none absolute top-[-70px] right-[8%] size-[280px] opacity-[0.08] max-[760px]:-right-[60px]"
            aria-hidden="true"
          />
          <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-6 px-6 py-10 min-[761px]:flex-row min-[761px]:items-center min-[761px]:justify-between min-[761px]:gap-12">
            <div>
              <h2 className="text-[clamp(30px,8vw,40px)] font-medium leading-[1.08] tracking-[-0.03em] min-[761px]:text-[40px]">
                Help shape Everr
                <span className="block font-semibold">Join us on Discord.</span>
              </h2>
              <p className="mt-3.5 max-w-[48ch] text-base leading-[1.6]">
                Drop your feature requests, share feedback, and help us decide
                what to build next. We’ll throw in a discount code as a thank
                you for helping us out.
              </p>
            </div>
            <a
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2.5 rounded-lg bg-primary-foreground px-5 py-3 font-semibold text-primary hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-primary-foreground [&>svg]:size-5 [&>svg]:shrink-0"
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <SiDiscord aria-hidden="true" />
              Join us on Discord
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </section>
        <FooterDirectory />
      </div>
    </footer>
  );
}

function FooterDirectory() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="grid grid-cols-2 gap-8 text-center md:grid-cols-4 md:text-left">
        {/* Brand */}
        <div className="col-span-2 mb-4 md:col-span-2 md:mb-0">
          <div className="flex items-center justify-center gap-2 font-semibold sm:justify-start font-heading">
            <Citrus className="size-8 text-primary" />
            <span className="text-2xl">Everr</span>
          </div>
          <p className="mt-4 text-sm text-fd-muted-foreground">
            Observability made simple.
          </p>
          <div className="mt-4 flex items-center justify-center gap-6 sm:gap-4 sm:justify-start">
            <a
              href="https://x.com/everrlabs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              aria-label="X (Twitter)"
            >
              <SiX className="size-5" />
            </a>
            {/** biome-ignore lint/a11y/useAnchorContent: LinkedIn icon */}
            <a
              href="https://www.linkedin.com/company/everr-labs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              aria-label="LinkedIn"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="size-5"
                aria-hidden="true"
              >
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </a>
            <a
              href="https://github.com/everr-labs/everr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              aria-label="GitHub"
            >
              <SiGithub className="size-5" />
            </a>
            <a
              href="https://discord.gg/hd6yYDjAuw"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              aria-label="Discord"
            >
              <SiDiscord className="size-5" />
            </a>
          </div>
          <div className="mt-6 flex justify-center sm:justify-start">
            <div className="inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/5 py-2 pr-5 pl-2">
              <span
                className="flex size-8 items-center justify-center rounded-full text-primary text-xl"
                aria-hidden="true"
              >
                🇪🇺
              </span>
              <span className="text-left leading-tight font-heading">
                <span className="block font-mono text-xs font-semibold uppercase tracking-widest text-primary">
                  Proudly
                </span>
                <span className="block text-sm font-bold text-fd-foreground">
                  Made in Europe
                </span>
              </span>
            </div>
          </div>
          <p className="mt-4 text-sm text-fd-muted-foreground">
            &copy; {new Date().getFullYear()} Everr
          </p>
        </div>

        {/* Product */}
        <div>
          <h3 className="mb-4 text-sm font-medium font-heading">Product</h3>
          <ul className="space-y-3">
            <li>
              <Link
                to="/docs/$"
                params={{ _splat: "" }}
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                Documentation
              </Link>
            </li>
            <li>
              <Link
                to="/pricing"
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                Pricing
              </Link>
            </li>
            <li>
              <a
                href="https://app.everr.dev"
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                Get started
              </a>
            </li>
          </ul>
        </div>

        {/* Resources */}
        <div>
          <h3 className="mb-4 text-sm font-medium font-heading">Resources</h3>
          <ul className="space-y-3">
            <li>
              <Link
                to="/docs/$"
                params={{ _splat: "cli" }}
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                CLI Docs
              </Link>
            </li>
            <li>
              <a
                href="https://discord.gg/hd6yYDjAuw"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                Discord
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
