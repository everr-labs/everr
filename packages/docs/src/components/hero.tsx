import { HoleBackground } from "@everr/ui/components/animate-ui/components/backgrounds/hole";
import { Button } from "@everr/ui/components/button";

export function Hero() {
  return (
    <div className="relative overflow-hidden aspect-video max-h-svh">
      <div className="[container-type:size] absolute inset-0 overflow-hidden">
        <HoleBackground className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 aspect-video h-auto w-[max(100cqw,177.78cqh)]" />
      </div>
      <div className="z-10 absolute inset-0 grid grid-cols-2 items-center max-w-7xl m-auto">
        <div className="flex gap-8 flex-col">
          <h1 className="text-6xl font-heading">
            Observability made simple.
            <br />
            <span className="text-primary">For Real.</span>
          </h1>
          <p>
            Everr is an open-source observability platform that makes it easy to
            monitor and debug your production systems.
          </p>
          <Button variant="cta" size="xl">
            Get Started
          </Button>
        </div>
        <div className="perspective-[1600px] perspective-origin-left ">
          <div className="bg-card h-[400px] w-[600px] rounded-md  -rotate-y-25 border border-card shadow-2xl">
            <img
              src="/screenshot.png"
              alt="Screenshot"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
