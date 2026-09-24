import { SiGithub } from "@icons-pack/react-simple-icons";
import { ArrowRight, Server } from "lucide-react";

export function SelfHostedBanner() {
  return (
    <section className="border-t-2 border-fd-border bg-fd-card/30">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-16 md:gap-16 md:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div>
          <p className="flex items-center gap-2 font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-primary">
            <Server className="size-4" strokeWidth={2.25} aria-hidden="true" />
            Self-hosted · Open source
          </p>
          <h2 className="mt-5 max-w-2xl text-balance font-heading text-3xl leading-[1.1] tracking-tight sm:text-4xl md:text-5xl">
            Run Everr on your own infrastructure.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            The source code is yours to use under AGPL-3.0. Set up and run Everr
            yourself, with no Everr license fee. You manage the infrastructure,
            updates, and backups.
          </p>
        </div>

        <div className="rounded-2xl border border-fd-border bg-fd-background p-7 sm:p-8">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.2em] text-fd-muted-foreground">
            Self-hosted
          </p>
          <div className="mt-5 flex items-end gap-2">
            <span className="font-mono text-5xl font-bold leading-none tracking-tight text-fd-foreground md:text-6xl">
              €0
            </span>
            <span className="pb-1 font-mono text-xs text-fd-muted-foreground">
              license fee
            </span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-fd-muted-foreground">
            Open source software. Your hosting costs depend on the
            infrastructure you choose.
          </p>
          <a
            href="https://github.com/everr-labs/everr"
            className="group mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-primary px-6 py-3.5 font-heading text-sm font-bold tracking-tight text-primary outline-none transition-colors duration-200 hover:bg-primary hover:text-fd-background focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
          >
            <SiGithub className="size-4" aria-hidden="true" />
            Explore the source
            <ArrowRight
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
              strokeWidth={2.5}
              aria-hidden="true"
            />
          </a>
        </div>
      </div>
    </section>
  );
}
