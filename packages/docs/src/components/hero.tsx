import { Button } from "@everr/ui/components/button";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { Link } from "@tanstack/react-router";
import { GITHUB_URL } from "@/constants";
import { HexagonPattern } from "./hexagon-pattern";
import { InstallCommand } from "./install-command";

export function Hero() {
  return (
    <div className="relative overflow-hidden md:flex md:min-h-[100svh] md:items-end">
      <div className="w-full px-6 pb-12 pt-28 sm:px-8 sm:pb-16 sm:pt-32 md:mb-24 md:px-12 md:pb-0 md:pt-0">
        <h1
          style={{ animationDelay: "0.3s" }}
          className="animate-fade-up max-w-4xl text-balance font-heading text-4xl leading-[1.05] sm:text-5xl md:text-7xl md:leading-[1.02] lg:text-8xl lg:leading-[1]"
        >
          Observability is{" "}
          <span className="relative everr-decoration everr-decoration-primary m-0">
            damn hard
          </span>
          .
        </h1>

        <div
          className="animate-fade-up mb-8 mt-7 max-w-2xl space-y-4 text-base leading-relaxed text-fd-muted-foreground sm:text-lg md:mb-10"
          style={{ animationDelay: "0.5s" }}
        >
          <p>
            After experiencing it ourselves, many times, we decided to build
            something that makes doing observability{" "}
            <span className="text-fd-foreground">
              as easy as building a web app
            </span>
            .
          </p>
          <p>
            Write a dashboard like you write{" "}
            <span className="text-fd-foreground">HTML</span>, and runbooks the
            same way you write <span className="text-fd-foreground">docs</span>.
            Test everything <span className="text-fd-foreground">locally</span>,
            before going in production.
          </p>
        </div>

        {/* Primary CTA: copy + run the install command. Docs / GitHub secondary. */}
        <div
          className="animate-fade-up flex max-w-xl flex-col gap-3"
          style={{ animationDelay: "0.8s" }}
        >
          <InstallCommand />
          <p className="px-1 font-mono text-xs text-fd-muted-foreground">
            macOS &amp; Linux
          </p>
          <div className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              size="xl"
              nativeButton={false}
              render={<Link to="/docs/$" params={{ _splat: "" }} />}
              className="w-full sm:w-auto"
            >
              Documentation
            </Button>
            <Button
              variant="ghost"
              size="xl"
              nativeButton={false}
              className="w-full sm:w-auto"
              render={
                // biome-ignore lint/a11y/useAnchorContent: content is injected
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <SiGithub className="size-5" />
              GitHub
            </Button>
          </div>
        </div>
      </div>
      <HexagonPattern
        gap={6}
        radius={48}
        strokeDasharray="8,3"
        className="-z-10"
      />
    </div>
  );
}
