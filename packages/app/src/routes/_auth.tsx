import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AsciiCitrus } from "./_auth/-components/ascii-citrus";

export const Route = createFileRoute("/_auth")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="relative min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[1.75fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-white/5 bg-black lg:block">
        <AsciiCitrus />

        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-10">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.4em] text-primary/80">
            <a href="/" className="font-heading z-1-">
              Everr
            </a>
          </div>

          <div className="max-w-md space-y-4">
            <h2 className="font-heading text-4xl uppercase leading-[0.88] sm:text-6xl">
              <span
                className="block animate-fade-up"
                style={{ animationDelay: "0.05s" }}
              >
                Software
              </span>
              <span
                className="block animate-fade-up"
                style={{ animationDelay: "0.1s" }}
              >
                delivery
              </span>
              <span
                className="block animate-fade-up"
                style={{ animationDelay: "0.15s" }}
              >
                <span className="relative inline-block px-1">
                  <span className="absolute inset-x-0 bottom-0 top-0 bg-primary" />
                  <span className="relative text-primary-foreground everr-decoration">
                    intelligence
                  </span>
                </span>
              </span>
            </h2>
          </div>
        </div>
      </aside>

      <Outlet />
    </div>
  );
}
