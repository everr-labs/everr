import { Dialog } from "@base-ui/react/dialog";
import { EverrLogo } from "@everr/ui/components/everr-logo";
import { cn } from "@everr/ui/lib/utils";
import { SiDiscord } from "@icons-pack/react-simple-icons";
import { Link, useLocation } from "@tanstack/react-router";
import FumaLink from "fumadocs-core/link";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { ArrowUpRight, Search } from "lucide-react";
import { animate, motion } from "motion/react";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GithubInfo } from "@/components/github-info";
import { DISCORD_URL, SIGN_UP_URL } from "@/constants";

export const NAV_LINKS = [
  { text: "Docs", url: "/docs" },
  { text: "Pricing", url: "/pricing" },
  { text: "Devlog", url: "/devlog" },
] as const;

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return scrolled;
}

export function SiteHeader() {
  const { pathname } = useLocation();
  const scrolled = useScrolled();
  const inDocs = pathname.startsWith("/docs");
  // Over the homepage hero the bar has no surface of its own until the page moves under it
  const solid = scrolled || pathname !== "/";

  return (
    <header id="nd-nav" className="sticky top-0 z-40 h-14">
      <div
        className={cn(
          "border-b transition-[background-color,border-color] duration-300",
          solid ? "border-border bg-background/90 backdrop-blur-xl" : "border-transparent",
        )}
      >
        <nav
          aria-label="Main"
          className={cn(
            "mx-auto flex h-14 items-center gap-2",
            inDocs ? "px-4" : "max-w-7xl px-4 sm:px-6",
          )}
        >
          <Link to="/" aria-label="Everr home" className={cn("mr-4 rounded-md", focusRing)}>
            <EverrLogo size="lg" className="text-[26px] [&>svg]:size-7" />
          </Link>
          <DesktopLinks pathname={pathname} />
          <div className="ml-auto flex items-center gap-1">
            <SearchButton />
            <Suspense fallback={null}>
              <GithubInfo
                aria-label="Everr on GitHub"
                owner="everr-labs"
                repo="everr"
                className={cn("items-center max-md:hidden", focusRing)}
              />
            </Suspense>
            <a
              href={SIGN_UP_URL}
              className={cn(
                "ml-2 inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform duration-200 ease-out-expo hover:scale-[1.04] active:scale-[0.98] max-[380px]:hidden",
                focusRing,
              )}
            >
              Get started
            </a>
            <MobileMenu pathname={pathname} />
          </div>
        </nav>
      </div>
    </header>
  );
}

// One highlight for the whole list. It rests on the current page, travels to
// whichever link the pointer or the keyboard is on, and is a single element
// the whole time, so it never drops out between two links or two pages.
function DesktopLinks({ pathname }: { pathname: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const current = NAV_LINKS.find(({ url }) => pathname.startsWith(url))?.url ?? null;
  const lit = hovered ?? current;

  useLayoutEffect(() => {
    const ul = list.current;
    const el = pill.current;
    if (!ul || !el) return;
    const place = (glide: boolean) => {
      const target = lit ? ul.querySelector<HTMLElement>(`[data-url="${lit}"]`) : null;
      if (!target) {
        placed.current = false;
        animate(el, { opacity: 0 }, { duration: 0.2 });
        return;
      }
      const box = { x: target.offsetLeft, width: target.offsetWidth };
      // Arriving from nowhere it fades in on the spot: only a pill already on screen glides
      if (placed.current && glide) {
        animate(el, box, { type: "spring", stiffness: 500, damping: 40 });
      } else {
        animate(el, box, { duration: 0 });
      }
      animate(el, { opacity: 1 }, { duration: 0.2 });
      placed.current = true;
    };
    place(true);
    // Link widths change when the font arrives. Observing reports once straight away: skip that one
    let first = true;
    const ro = new ResizeObserver(() => {
      if (!first) place(false);
      first = false;
    });
    ro.observe(ul);
    return () => ro.disconnect();
  }, [lit]);

  return (
    <ul
      ref={list}
      className="relative flex items-center max-md:hidden"
      onPointerLeave={() => setHovered(null)}
    >
      <li aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0">
        <span ref={pill} className="block h-full w-0 rounded-full bg-foreground/10 opacity-0" />
      </li>
      {NAV_LINKS.map(({ text, url }) => {
        const active = url === current;
        return (
          <li key={url} data-url={url} className="relative">
            <FumaLink
              href={url}
              aria-current={active ? "page" : undefined}
              onPointerEnter={() => setHovered(url)}
              onFocus={() => setHovered(url)}
              onBlur={() => setHovered(null)}
              className={cn(
                "block rounded-full px-3 py-2 text-sm transition-colors",
                active ? "text-foreground" : "text-foreground/65 hover:text-foreground",
                focusRing,
              )}
            >
              {text}
            </FumaLink>
          </li>
        );
      })}
    </ul>
  );
}

function SearchButton() {
  const { enabled, setOpenSearch } = useSearchContext();
  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => setOpenSearch(true)}
      aria-label="Search the docs"
      className={cn(
        "flex h-9 cursor-pointer items-center gap-2 rounded-full px-2.5 text-sm text-foreground/65 transition-colors hover:bg-foreground/10 hover:text-foreground",
        focusRing,
      )}
    >
      <Search className="size-4" aria-hidden="true" />
      <span className="max-lg:hidden">Search</span>
      <kbd className="rounded-md border border-border px-1.5 py-0.5 font-sans text-[11px] leading-none text-foreground/50 max-lg:hidden">
        ⌘K
      </kbd>
    </button>
  );
}

function MobileMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal="trap-focus">
      <Dialog.Trigger
        aria-label={open ? "Close menu" : "Open menu"}
        className={cn(
          "relative z-50 grid size-9 cursor-pointer place-items-center rounded-full md:hidden",
          focusRing,
        )}
      >
        <span className="relative block h-3 w-5" aria-hidden="true">
          <span
            className={cn(
              "absolute inset-x-0 top-0 h-0.5 rounded-full bg-foreground transition-transform duration-300 ease-out-expo",
              open && "translate-y-[5px] rotate-45",
            )}
          />
          <span
            className={cn(
              "absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground transition-transform duration-300 ease-out-expo",
              open && "-translate-y-[5px] -rotate-45",
            )}
          />
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Popup className="fixed inset-0 z-30 flex flex-col bg-background px-6 pt-20 pb-8 transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 md:hidden">
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <ul className="grid">
            {NAV_LINKS.map(({ text, url }, i) => (
              <motion.li
                key={url}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                className="border-b border-border"
              >
                <FumaLink
                  href={url}
                  onClick={close}
                  aria-current={pathname.startsWith(url) ? "page" : undefined}
                  className="display flex items-center justify-between py-5 text-[44px] aria-[current=page]:text-primary"
                >
                  {text}
                </FumaLink>
              </motion.li>
            ))}
          </ul>
          <div className="mt-8 flex gap-6 text-foreground/70">
            <a
              href="https://github.com/everr-labs/everr"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-base"
            >
              GitHub <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 text-base"
            >
              <SiDiscord className="size-4" aria-hidden="true" /> Discord
            </a>
          </div>
          <a
            href={SIGN_UP_URL}
            className="mt-auto inline-flex h-13 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground"
          >
            Get started
          </a>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
