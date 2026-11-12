import { SiDiscord, SiGithub, SiX } from "@icons-pack/react-simple-icons";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { LanguageMenu } from "@/components/language-switch";
import { Mascot } from "@/components/mascot";
import { DISCORD_URL } from "@/constants";
import { m } from "@/paraglide/messages";

export function Footer() {
  return (
    <footer className="border-t border-fd-border bg-background">
      <div className="w-full">
        <section className="border-b border-fd-border">
          <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-12">
            <div>
              <h2 className="text-2xl font-medium leading-[1.15] tracking-[-0.02em] sm:text-[28px]">
                {m.footer_discord_heading()}
              </h2>
              <p className="mt-3 max-w-[58ch] text-base leading-[1.6] text-fd-muted-foreground">
                {m.footer_discord_body()}
              </p>
            </div>
            <a
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2.5 rounded-full border border-foreground/25 px-5 py-3 font-semibold text-foreground transition-colors duration-200 hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-primary [&>svg]:size-5 [&>svg]:shrink-0 motion-reduce:transition-none"
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <SiDiscord aria-hidden="true" />
              {m.footer_discord_cta()}
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
      <div className="grid grid-cols-3 gap-x-4 gap-y-8 text-center sm:gap-8 md:grid-cols-5 md:text-left">
        {/* Brand */}
        <div className="col-span-3 mb-4 md:col-span-2 md:mb-0">
          <span className="flex w-full items-center justify-center gap-0.5 font-heading text-3xl font-semibold sm:justify-start">
            <Mascot
              reach={30}
              eyesClassName="fill-primary"
              raysClassName="fill-primary"
              className="size-8 shrink-0"
            />
            everr
          </span>
          <p className="mt-4 text-sm text-fd-muted-foreground">Observability made simple.</p>
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
            {/** oxlint-disable-next-line jsx-a11y/control-has-associated-label -- LinkedIn icon */}
            <a
              href="https://www.linkedin.com/company/everr-labs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              aria-label="LinkedIn"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden="true">
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
            <p className="inline-flex items-center gap-2 text-sm text-fd-muted-foreground">
              <span aria-hidden="true">🇪🇺</span>
              {m.footer_made_in()}
            </p>
          </div>
          <p className="mt-4 flex items-center justify-center gap-3 text-sm text-fd-muted-foreground sm:justify-start">
            &copy; {new Date().getFullYear()} Everr
            <LanguageMenu
              side="top"
              className="rounded-full border border-border px-3 py-1.5 transition-colors hover:text-fd-foreground data-[popup-open]:text-fd-foreground"
            />
          </p>
        </div>

        {/* Product */}
        <div>
          <h3 className="mb-4 text-sm font-medium font-heading">{m.footer_product()}</h3>
          <ul className="space-y-3">
            <li>
              <Link
                to="/docs/$"
                params={{ _splat: "" }}
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                {m.footer_documentation()}
              </Link>
            </li>
            <li>
              <Link
                to="/pricing"
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                {m.nav_pricing()}
              </Link>
            </li>
            <li>
              <a
                href="https://app.everr.dev/auth/sign-up"
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                {m.get_started()}
              </a>
            </li>
          </ul>
        </div>

        {/* Resources */}
        <div>
          <h3 className="mb-4 text-sm font-medium font-heading">{m.footer_resources()}</h3>
          <ul className="space-y-3">
            <li>
              <Link
                to="/docs/$"
                params={{ _splat: "cli" }}
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                {m.footer_cli_docs()}
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
        {/* Company */}
        <div>
          <h3 className="mb-4 text-sm font-medium font-heading">{m.footer_company()}</h3>
          <ul className="space-y-3">
            <li>
              <Link
                to="/$page"
                params={{ page: "about" }}
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                {m.footer_about()}
              </Link>
            </li>
            <li>
              <Link
                to="/$page"
                params={{ page: "contact" }}
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                {m.footer_contact()}
              </Link>
            </li>
            <li>
              <Link
                to="/$page"
                params={{ page: "privacy" }}
                className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
              >
                {m.footer_privacy()}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
