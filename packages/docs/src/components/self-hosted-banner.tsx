import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";

export function SelfHostedBanner() {
  return (
    <section className="border-t-2 border-fd-border bg-fd-card/30">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-16 md:gap-16 md:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div>
          <Eyebrow>Self-hosted · Open source</Eyebrow>
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
          <Eyebrow>Self-hosted</Eyebrow>
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
          <Button
            variant="outline"
            nativeButton={false}
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is injected by Button
              <a href="https://github.com/everr-labs/everr" />
            }
            className="mt-7 w-full"
          >
            Explore the source
          </Button>
        </div>
      </div>
    </section>
  );
}
