import { Button } from "@everr/ui/components/button";
import { SiDiscord } from "@icons-pack/react-simple-icons";
import { DISCORD_URL } from "@/constants";

export function Community() {
  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground selection:bg-primary-foreground selection:text-primary">
      {/* Oversized decorative Discord icon */}
      <SiDiscord
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-16 size-85 text-primary-foreground/10 sm:-right-8 sm:size-105 md:-right-4 md:size-130"
      />

      <div className="relative mx-auto max-w-7xl px-6 py-16 sm:py-20 md:py-28">
        <p className="font-heading text-[11px] font-bold uppercase tracking-[0.3em] text-primary-foreground/60">
          Community
        </p>

        <h2 className="mt-4 max-w-3xl font-heading text-4xl uppercase leading-[0.9] sm:text-5xl md:text-6xl lg:text-7xl">
          Talk to the team.
          <br />
          Shape what ships next.
        </h2>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-primary-foreground/80 md:text-xl">
          It's where we talk with the people using Everr. Drop feature requests,
          share feedback, and weigh in on what we build next.
        </p>

        <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center md:mt-12">
          <Button
            variant="outline"
            size="xl"
            nativeButton={false}
            className="border-2 border-primary-foreground bg-primary-foreground text-primary hover:bg-primary-foreground/90 hover:text-primary focus-visible:ring-primary-foreground ring-offset-primary focus-visible:border-primary-foreground"
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is injected
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <SiDiscord className="size-5" />
            Join Us on Discord
          </Button>
        </div>
      </div>
    </section>
  );
}
