import { Link } from "@tanstack/react-router";
import { Citrus } from "lucide-react";

const APP_URL = "https://app.everr.dev";

export function Footer() {
  return (
    <footer className="border-t border-fd-border bg-fd-secondary/30">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-3">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 font-semibold">
              <Citrus className="size-5" />
              Everr
            </div>
            <p className="text-sm text-fd-muted-foreground">
              OpenTelemetry-native CI/CD observability for humans and AI agents
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Product</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/docs/$"
                  params={{ _splat: "" }}
                  className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  Documentation
                </Link>
              </li>
              <li>
                <a
                  href={APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  Get started
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Resources</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/docs/$"
                  params={{ _splat: "getting-started" }}
                  className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  Getting started
                </Link>
              </li>
              <li>
                <Link
                  to="/docs/$"
                  params={{ _splat: "reference/mcp-server" }}
                  className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  MCP reference
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-fd-border pt-6 text-xs text-fd-muted-foreground sm:flex-row">
          <span>&copy; {new Date().getFullYear()} Everr</span>
          <span>
            Built with{" "}
            <a
              href="https://fumadocs.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-fd-foreground transition-colors"
            >
              Fumadocs
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
