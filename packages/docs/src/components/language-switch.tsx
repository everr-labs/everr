import { Menu } from "@base-ui/react/menu";
import { useLocation } from "@tanstack/react-router";
import { Check, ChevronDown, Globe } from "lucide-react";
import { cn } from "@everr/ui/lib/utils";
import { isTranslatedPath } from "@/lib/translated";
import { m } from "@/paraglide/messages";
import { getLocale, type Locale, locales, localizeHref } from "@/paraglide/runtime";

// Each language in its own name, so a reader finds theirs whatever the page is in.
const NAMES: Record<Locale, string> = { en: "English", it: "Italiano" };

function useTranslatedPath() {
  const { pathname } = useLocation();
  return isTranslatedPath(pathname) ? pathname : null;
}

/**
 * A menu of the languages this page exists in, or nothing on a page that has one language.
 * The entries are plain links on purpose: changing language loads the page again, so every
 * string is redrawn.
 */
export function LanguageMenu({
  short = false,
  side = "bottom",
  className,
}: {
  /** The language code instead of its name */
  short?: boolean;
  side?: "top" | "bottom";
  className?: string;
}) {
  const pathname = useTranslatedPath();
  if (!pathname) return null;
  const current = getLocale();

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${m.language_label()}: ${NAMES[current]}`}
        className={cn("inline-flex cursor-pointer items-center gap-1.5", className)}
      >
        <Globe className="size-4 shrink-0" aria-hidden="true" />
        {short ? current.toUpperCase() : NAMES[current]}
        {!short && <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side={side} align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="min-w-44 origin-(--transform-origin) rounded-2xl border border-border bg-fd-popover p-1.5 text-sm text-fd-popover-foreground shadow-lg transition-[opacity,scale] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            {locales.map((locale) => (
              <Menu.LinkItem
                key={locale}
                href={localizeHref(pathname, { locale })}
                hrefLang={locale}
                lang={locale}
                aria-current={locale === current ? "true" : undefined}
                className="flex cursor-pointer items-center justify-between gap-6 rounded-lg px-3 py-2 text-foreground/75 outline-none data-[highlighted]:bg-foreground/10 data-[highlighted]:text-foreground aria-[current=true]:text-foreground"
              >
                {NAMES[locale]}
                {locale === current && <Check className="size-4 text-primary" aria-hidden="true" />}
              </Menu.LinkItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The same choice laid out as a row of links, for places that are already a menu. */
export function LanguageList({ className }: { className?: string }) {
  const pathname = useTranslatedPath();
  if (!pathname) return null;
  const current = getLocale();

  return (
    <ul aria-label={m.language_label()} className={cn("flex flex-wrap gap-x-5 gap-y-2", className)}>
      {locales.map((locale) => (
        <li key={locale}>
          <a
            href={localizeHref(pathname, { locale })}
            hrefLang={locale}
            lang={locale}
            aria-current={locale === current ? "true" : undefined}
            className="text-foreground/55 aria-[current=true]:text-foreground"
          >
            {NAMES[locale]}
          </a>
        </li>
      ))}
    </ul>
  );
}
