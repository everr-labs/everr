import { Link } from "@tanstack/react-router";
import { Citrus } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-fd-border">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-8 text-center md:grid-cols-4 md:text-left">
          {/* Brand */}
          <div className="col-span-2 mb-4 md:col-span-2 md:mb-0">
            <div className="flex items-center justify-center gap-2 font-semibold sm:justify-start">
              <Citrus className="size-8" />
              <span className="text-2xl">Everr</span>
            </div>
            <p className="mt-4 text-sm text-fd-muted-foreground">
              OpenTelemetry-native CI/CD observability
              <br />
              for humans and AI agents
            </p>
            <p className="mt-2 text-sm text-fd-muted-foreground">
              &copy; {new Date().getFullYear()} Everr
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="mb-4 text-sm font-medium">Product</h3>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/docs/$"
                  params={{ _splat: "" }}
                  className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                >
                  Documentation
                </Link>
              </li>
              <li>
                <a
                  href="https://app.everr.dev"
                  className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                >
                  Get started
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="mb-4 text-sm font-medium">Resources</h3>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/docs/$"
                  params={{ _splat: "mcp/getting-started" }}
                  className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                >
                  MCP Reference
                </Link>
              </li>
              <li>
                <Link
                  to="/docs/$"
                  params={{ _splat: "cli" }}
                  className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                >
                  CLI Docs
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
