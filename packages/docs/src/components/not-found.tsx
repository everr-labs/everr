import { Link } from "@tanstack/react-router";
import { Footer } from "@/components/footer";

export function NotFound() {
  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
        <h1 className="text-6xl font-bold text-fd-muted-foreground">404</h1>
        <h2 className="text-2xl font-semibold">Page Not Found</h2>
        <p className="text-fd-muted-foreground max-w-md">
          The page you are looking for might have been removed, had its name changed, or is
          temporarily unavailable.
        </p>
        <nav aria-label="Where to look next" className="text-sm text-fd-muted-foreground">
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            <li>
              <Link to="/docs/$" params={{ _splat: "" }} className="hover:text-fd-foreground">
                Docs
              </Link>
            </li>
            <li>
              <a href="/sitemap.xml" className="hover:text-fd-foreground">
                Sitemap
              </a>
            </li>
            <li>
              <a href="/llms.txt" className="hover:text-fd-foreground">
                llms.txt
              </a>
            </li>
          </ul>
        </nav>
        <Link
          to="/"
          className="mt-4 px-4 py-2 rounded-full bg-fd-primary text-fd-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
        >
          Back to Home
        </Link>
      </div>
      <Footer />
    </>
  );
}
