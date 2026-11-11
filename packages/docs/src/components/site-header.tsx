import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@everr/ui/lib/utils";
import { SiDiscord } from "@icons-pack/react-simple-icons";
import { Link, useLocation } from "@tanstack/react-router";
import FumaLink from "fumadocs-core/link";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { ArrowUpRight, Globe, Search } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GithubInfo } from "@/components/github-info";
import { LanguageList, LanguageMenu } from "@/components/language-switch";
import { Mascot } from "@/components/mascot";
import { DISCORD_URL, SIGN_UP_URL } from "@/constants";
import { m } from "@/paraglide/messages";

const NAV_LINKS = [
  { text: m.nav_docs, url: "/docs" },
  { text: m.nav_pricing, url: "/pricing" },
  { text: m.nav_devlog, url: "/devlog" },
] as const;

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// The header condenses a little way down the page and opens again only near
// the very top. The gap between the two keeps it from flipping back and forth
// when the page rests around one line.
const CONDENSE_AT = 96;
const EXPAND_AT = 32;

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled((was) => window.scrollY > (was ? EXPAND_AT : CONDENSE_AT));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return scrolled;
}

// A label that folds away sideways when the header condenses
function Folding({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "grid transition-[grid-template-columns,opacity] duration-500 ease-out-expo",
        open ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
        className,
      )}
    >
      <span className="overflow-hidden whitespace-nowrap">{children}</span>
    </span>
  );
}

const ISLAND =
  "h-12 border-white/12 bg-card/80 pr-1.5 pl-3.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)] backdrop-blur-xl";
const ISLAND_ON_PHONES =
  "max-md:h-12 max-md:border-white/12 max-md:bg-card/80 max-md:pr-1.5 max-md:pl-3.5 max-md:shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)] max-md:backdrop-blur-xl";

export function SiteHeader() {
  const { pathname } = useLocation();
  const scrolled = useScrolled();

  // The docs keep a plain bar: their sidebar and page layout hang off its full width
  if (pathname.startsWith("/docs")) {
    return (
      <header id="nd-nav" className="sticky top-0 z-40 h-14">
        <div className="border-b border-border bg-background/90 backdrop-blur-xl">
          <nav aria-label={m.nav_main()} className="flex h-14 items-center gap-2 px-4">
            <Link
              to="/"
              aria-label={m.nav_home()}
              className={cn(
                "mr-4 flex items-center rounded-md font-heading text-[26px] font-semibold",
                focusRing,
              )}
            >
              <Mascot
                reach={30}
                eyesClassName="fill-primary"
                raysClassName="fill-primary"
                className="size-7 shrink-0"
              />
              <span className="pl-0.5">everr</span>
            </Link>
            <DesktopLinks pathname={pathname} />
            <Actions pathname={pathname} compact={false} />
          </nav>
        </div>
      </header>
    );
  }

  // Everywhere else the header is part of the page at the top, tall, with the
  // logo at size. Once the page moves it gathers into an island that floats
  // over it. The header keeps its tall box either way, so nothing below shifts.
  // A phone has no room for the tall one: there it is the island from the start,
  // and the island keeps the wordmark.
  return (
    <header id="nd-nav" className="pointer-events-none sticky top-0 z-40 h-16 md:h-24">
      <div
        className={cn(
          "mx-auto transition-[max-width,padding] duration-500 ease-out-expo",
          scrolled ? "max-w-[43rem] px-3 pt-2" : "max-w-7xl max-md:px-3 max-md:pt-2",
        )}
      >
        <nav
          aria-label={m.nav_main()}
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-full border transition-[height,padding,background-color,border-color,box-shadow] duration-500 ease-out-expo",
            scrolled ? ISLAND : `md:h-24 md:border-transparent md:px-6 ${ISLAND_ON_PHONES}`,
          )}
        >
          <Link
            to="/"
            aria-label={m.nav_home()}
            className={cn(
              "flex items-center rounded-md font-heading font-semibold transition-[margin,font-size] duration-500 ease-out-expo",
              scrolled
                ? "mr-1 text-[26px]"
                : "max-md:mr-1 max-md:text-[26px] md:mr-8 md:text-[40px]",
              focusRing,
            )}
          >
            {/* The mark keeps an eye on the pointer */}
            <Mascot
              reach={30}
              eyesClassName="fill-primary"
              raysClassName="fill-primary"
              className={cn(
                "shrink-0 transition-[width,height] duration-500 ease-out-expo",
                scrolled ? "size-7" : "size-7 md:size-11",
              )}
            />
            <Folding open={!scrolled} className="max-md:grid-cols-[1fr] max-md:opacity-100">
              <span className="pl-0.5">everr</span>
            </Folding>
          </Link>
          {/* Beside the big wordmark, the bar's middle is not where the eye puts it: the letters
              sit below it, and so does the body of the mark. The items drop to meet them. */}
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 transition-[translate] duration-500 ease-out-expo",
              !scrolled && "md:translate-y-[3px]",
            )}
          >
            <DesktopLinks pathname={pathname} />
            <Actions pathname={pathname} compact={scrolled} />
          </div>
        </nav>
      </div>
    </header>
  );
}

function Actions({ pathname, compact }: { pathname: string; compact: boolean }) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <SearchButton compact={compact} />
      <GithubInfo
        aria-label={m.nav_github_label()}
        owner="everr-labs"
        repo="everr"
        className={cn("items-center max-md:hidden", focusRing)}
      />
      <LanguageMenu
        short
        className={cn(
          "h-9 rounded-full px-2.5 text-sm text-foreground/65 transition-colors hover:bg-foreground/10 hover:text-foreground data-[popup-open]:bg-foreground/10 data-[popup-open]:text-foreground max-md:hidden",
          focusRing,
        )}
      />
      <a
        href={SIGN_UP_URL}
        className={cn(
          "ml-2 inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform duration-200 ease-out-expo hover:scale-[1.04] active:scale-[0.98] max-[380px]:hidden",
          focusRing,
        )}
      >
        {m.get_started()}
      </a>
      <MobileMenu pathname={pathname} />
    </div>
  );
}

// One highlight for the whole list. It rests on the current page, travels to
// whichever link the pointer or the keyboard is on, and is a single element
// the whole time, so it never drops out between two links or two pages.
function DesktopLinks({ pathname }: { pathname: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const fresh = useRef(true);
  const current = NAV_LINKS.find(({ url }) => pathname.startsWith(url))?.url ?? null;
  const lit = hovered ?? current;

  useLayoutEffect(() => {
    const ul = list.current;
    const el = pill.current;
    if (!ul || !el) return;
    // Written straight to the element, so it is in place before the browser paints
    const set = (styles: Partial<CSSStyleDeclaration>, instant: boolean) => {
      if (!instant) {
        Object.assign(el.style, styles);
        return;
      }
      el.style.transition = "none";
      Object.assign(el.style, styles);
      // Reading layout applies the styles before the transition comes back
      void el.offsetWidth;
      el.style.transition = "";
    };
    const place = (glide: boolean) => {
      const target = lit ? ul.querySelector<HTMLElement>(`[data-url="${lit}"]`) : null;
      if (!target) {
        el.style.opacity = "0";
        return;
      }
      const box = {
        transform: `translateX(${target.offsetLeft}px)`,
        width: `${target.offsetWidth}px`,
      };
      if (el.style.opacity === "1" && glide) {
        set(box, false);
      } else if (fresh.current) {
        // The docs and the other pages draw this list in different bars. Coming up in a new
        // one, the pill is simply there: fading in would read as a flicker between pages.
        set({ ...box, opacity: "1" }, true);
      } else {
        // Arriving from nowhere it fades in on the spot: only a pill already on screen glides
        set(box, true);
        el.style.opacity = "1";
      }
    };
    place(true);
    fresh.current = false;
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
        <span
          ref={pill}
          className="block h-full w-0 rounded-full bg-foreground/10 opacity-0 transition-[transform,width,opacity] duration-300 ease-out-expo"
        />
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
              {text()}
            </FumaLink>
          </li>
        );
      })}
    </ul>
  );
}

function SearchButton({ compact }: { compact: boolean }) {
  const { enabled, setOpenSearch } = useSearchContext();
  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => setOpenSearch(true)}
      aria-label={m.nav_search_label()}
      className={cn(
        "flex h-9 cursor-pointer items-center rounded-full px-2.5 text-sm text-foreground/65 transition-colors hover:bg-foreground/10 hover:text-foreground",
        focusRing,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="max-lg:hidden">
        <Folding open={!compact}>
          <span className="flex items-center gap-2 pl-2">
            {m.nav_search()}
            <kbd className="rounded-md border border-border px-1.5 py-0.5 font-sans text-[11px] leading-none text-foreground/50">
              ⌘K
            </kbd>
          </span>
        </Folding>
      </span>
    </button>
  );
}

function MobileMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal="trap-focus">
      <Dialog.Trigger
        aria-label={open ? m.nav_menu_close() : m.nav_menu_open()}
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
          <Dialog.Title className="sr-only">{m.nav_menu()}</Dialog.Title>
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
                  {text()}
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
          <div className="mt-6 flex items-center gap-3 border-t border-border pt-6 text-base">
            <Globe className="size-4 shrink-0 text-foreground/55" aria-hidden="true" />
            <LanguageList />
          </div>
          <a
            href={SIGN_UP_URL}
            className="mt-auto inline-flex h-13 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground"
          >
            {m.get_started()}
          </a>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
