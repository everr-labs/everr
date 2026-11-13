import { cn } from "@everr/ui/lib/utils";
import { Link, useLocation } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Footer } from "@/components/footer";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";

const ease = [0.16, 1, 0.3, 1] as const;

// The request as a trace: the lookup finds nothing, so the render never starts
const SPANS: Span[] = [
  { name: "router.match", start: 4, width: 22 },
  { name: "page.lookup", start: 26, width: 30, event: true },
  { name: "page.render", start: 56, width: 40, missing: true },
];

type Span = {
  name: string;
  start: number;
  width: number;
  root?: boolean;
  // Ends with the page.not_found event
  event?: boolean;
  // Never ran
  missing?: boolean;
};

// A stable id per path, so the server and the browser render the same one
function traceId(path: string) {
  const hash = (seed: number) => {
    let h = seed;
    for (const char of path) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return hash(2166136261) + hash(374761393);
}

export function NotFound() {
  const { pathname } = useLocation();
  const id = traceId(pathname);

  return (
    <>
      <section className="relative flex-1 overflow-hidden text-foreground">
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 pt-10 pb-20 sm:px-6 md:pt-16 md:pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
          <div>
            <TraceListRow pathname={pathname} id={id} />

            {/* 404 with the mascot as the zero, looking around for the page. The rays leave room
                on its right, so the second 4 tucks in closer */}
            <div
              aria-hidden="true"
              className="display mt-10 flex items-center text-[clamp(7rem,30vw,22rem)] leading-[0.8] select-none lg:text-[min(14vw,16rem)]"
            >
              <motion.span
                initial={{ y: "40%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.9, ease }}
              >
                4
              </motion.span>
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1, delay: 0.12, ease }}
                className="mr-[-0.12em] ml-[0.02em] inline-flex"
              >
                <Mascot
                  glow
                  reach={60}
                  eyesClassName="fill-primary"
                  raysClassName="fill-primary"
                  className="size-[0.82em]"
                />
              </motion.span>
              <motion.span
                initial={{ y: "40%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.9, delay: 0.08, ease }}
              >
                4
              </motion.span>
            </div>

            <motion.div
              className="mt-10 md:mt-12"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease }}
            >
              <h1 className="display text-[clamp(2.25rem,5vw,4.25rem)]">
                <span className="sr-only">404: </span>Nothing to observe here.
              </h1>
              <p className="mt-6 max-w-[34rem] text-lg leading-[1.55] text-pretty text-foreground/70 md:text-xl">
                We traced this request end to end. The end came early: there is no page at{" "}
                <code className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[0.85em] break-all text-fd-foreground">
                  {pathname}
                </code>
                .
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button nativeButton={false} render={<Link to="/" />}>
                  Take me home
                </Button>
                <Button
                  variant="secondary"
                  nativeButton={false}
                  render={<Link to="/docs/$" params={{ _splat: "" }} />}
                >
                  Browse the docs
                </Button>
              </div>
              <p className="mt-6 text-sm text-fd-muted-foreground">
                Sent by an agent? Try{" "}
                <a href="/llms.txt" className="text-primary hover:underline">
                  llms.txt
                </a>{" "}
                or the{" "}
                <a href="/sitemap.xml" className="text-primary hover:underline">
                  sitemap
                </a>
                .
              </p>
            </motion.div>
          </div>

          {/* Decoration: phones get the page without it */}
          <TraceCard pathname={pathname} id={id} />
        </div>
      </section>
      <Footer />
    </>
  );
}

// This request as a row of the traces list in the app: method, route, trace id,
// service and status
function TraceListRow({ pathname, id }: { pathname: string; id: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease }}
      className="flex max-w-xl items-center gap-2 rounded-lg border border-fd-border bg-fd-card/70 px-3 py-2 text-sm leading-tight backdrop-blur"
    >
      <span className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-1 font-mono text-xs tracking-wide text-sky-400">
        GET
      </span>
      <span className="min-w-0 truncate font-medium">{pathname}</span>
      <span className="shrink-0 font-mono text-xs text-fd-muted-foreground">{id.slice(0, 8)}</span>
      <span className="ml-auto hidden shrink-0 items-center gap-1.5 text-xs text-fd-muted-foreground sm:flex">
        <span className="size-2 rounded-full bg-primary" />
        everr-docs
      </span>
      <span className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 max-sm:ml-auto px-1.5 font-mono text-xs text-emerald-400">
        404
      </span>
    </motion.div>
  );
}

function TraceCard({ pathname, id }: { pathname: string; id: string }) {
  const rows: Span[] = [{ name: `GET ${pathname}`, start: 0, width: 100, root: true }, ...SPANS];
  return (
    <motion.figure
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.45, ease }}
      aria-label="The trace of this request, which ends without a page"
      className="overflow-hidden rounded-2xl border border-fd-border bg-fd-card/80 font-mono text-xs shadow-2xl shadow-black/40 backdrop-blur max-md:hidden"
    >
      <figcaption className="flex items-center gap-3 px-5 pt-5 text-fd-muted-foreground">
        <span>trace {id.slice(0, 8)}</span>
        <span className="ml-auto">11.4 ms</span>
        <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-emerald-400">
          404
        </span>
      </figcaption>

      <div className="space-y-3 px-5 pt-5 pb-6">
        {rows.map((span, i) => (
          <SpanRow key={span.name} span={span} delay={0.6 + i * 0.15} />
        ))}
      </div>

      <div className="border-t border-fd-border bg-background/60 px-5 py-3.5 leading-relaxed">
        {/* A 404 is the client's mistake: the server span keeps an unset status and the
            log is a warning, as the OTel HTTP conventions have it */}
        <span className="text-amber-400">WARN</span>{" "}
        <span className="text-fd-muted-foreground">page.not_found</span>{" "}
        <span className="text-fd-muted-foreground">url.path=</span>
        <span className="break-all text-fd-foreground">{pathname}</span>{" "}
        <span className="text-fd-muted-foreground">http.response.status_code=</span>
        <span className="text-fd-foreground">404</span>{" "}
        <span className="text-fd-muted-foreground">everr.hint=</span>
        <Link
          to="/docs/$"
          params={{ _splat: "" }}
          className="text-primary underline-offset-2 hover:underline"
        >
          /docs
        </Link>
      </div>
    </motion.figure>
  );
}

function SpanRow({ span, delay }: { span: Span; delay: number }) {
  const { name, start, width, root, event, missing } = span;
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)]">
      <span
        className={cn(
          "truncate",
          root ? "text-fd-foreground" : "pl-3 text-fd-muted-foreground",
          missing && "text-red-400/90",
        )}
      >
        {name}
      </span>
      <div className="relative h-4">
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay, ease }}
          style={{ left: `${start}%`, width: `${width}%` }}
          className={cn(
            "absolute inset-y-0 origin-left rounded-full",
            missing
              ? "border border-dashed border-red-400/60"
              : root
                ? "bg-primary/20"
                : "bg-primary",
          )}
        >
          {event && (
            <span className="absolute top-1/2 -right-1.5 size-3 -translate-y-1/2 rounded-full bg-amber-400 ring-4 ring-fd-card" />
          )}
          {missing && (
            <span className="absolute inset-0 hidden items-center justify-center text-[10px] text-red-400/90 sm:flex">
              never started
            </span>
          )}
        </motion.div>
      </div>
    </div>
  );
}
