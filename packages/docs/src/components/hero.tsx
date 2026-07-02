import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";
import screenshot from "../assets/screenshot.webp?url";
import { HoleBackground } from "./animate-ui/components/backgrounds/hole";
import { InstallCommand } from "./ui/install-command";

export function Hero() {
  return (
    <div className="relative overflow-x-clip md:h-[min(56.25vw,100svh)] md:overflow-hidden">
      <div className="@container-size absolute inset-0 overflow-hidden">
        <HoleBackground className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 aspect-video h-auto w-[max(100cqw,177.78cqh)]" />
      </div>
      <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-8 px-6 py-16 md:grid md:h-full md:grid-cols-2 md:items-center md:py-0 md:px-8">
        <div className="flex flex-col gap-8">
          <h1 className="font-heading text-4xl md:text-6xl">
            Observability made simple.
            <br />
            <span className="text-primary font-medium">For real.</span>
          </h1>
          <p className="max-w-prose">
            Setting up observability shouldn&rsquo;t take days. Get started in
            minutes.
          </p>
          <InstallCommand className="w-full max-w-lg bg-fd-card/70 backdrop-blur-sm" />
          <div>
            <Button
              variant="secondary"
              size="xl"
              nativeButton={false}
              render={<Link to="/docs/$" params={{ _splat: "" }} />}
            >
              Read the docs
            </Button>
          </div>
        </div>
        <div className="perspective-[1600px] perspective-origin-left">
          <div className="bg-card aspect-3/2 w-full overflow-hidden rounded-md border border-card shadow-2xl md:aspect-auto md:h-100 md:w-150 md:-rotate-y-25">
            <img
              src={screenshot}
              alt="The Everr app showing a Kubernetes infrastructure dashboard with CPU, memory, and pod metrics"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
