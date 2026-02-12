import { Link } from "@tanstack/react-router";
import { Citrus } from "lucide-react";

const GITHUB_URL = "https://github.com/citric-app/citric";

export function Footer() {
  return (
    <footer className="border-t border-fd-border bg-fd-secondary/30">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-3">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 font-semibold">
              <Citrus className="size-5" />
              Citric
            </div>
            <p className="text-sm text-fd-muted-foreground">
              OpenTelemetry-native CI/CD Observability
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
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Project</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href={`${GITHUB_URL}/blob/main/CONTRIBUTING.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  Contributing
                </a>
              </li>
              <li>
                <a
                  href={`${GITHUB_URL}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                >
                  Report an Issue
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-fd-border pt-6 text-xs text-fd-muted-foreground sm:flex-row">
          <span>&copy; {new Date().getFullYear()} Citric</span>
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
