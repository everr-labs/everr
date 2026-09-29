import { EverrLogo } from "@everr/ui/components/everr-logo";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AsciiCitrus } from "./_auth/-components/ascii-citrus";

export const Route = createFileRoute("/_auth")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="relative min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[1.15fr_1fr] xl:grid-cols-[1.15fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-white/5 bg-black lg:block">
        <AsciiCitrus />

        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-10">
          <a
            href="https://everr.dev"
            className="pointer-events-auto self-start text-foreground"
          >
            <EverrLogo />
          </a>

          <p className="animate-fade-up whitespace-nowrap font-heading text-[clamp(2rem,3.3vw,4rem)] leading-none tracking-tight text-white">
            Observability made simple
          </p>
        </div>
      </aside>

      <Outlet />
    </div>
  );
}
