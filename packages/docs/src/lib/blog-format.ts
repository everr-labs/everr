import type { Locale } from "@/paraglide/runtime";

const DATE_LOCALES: Record<Locale, string> = { en: "en-US", it: "it-IT" };

export const OG_LOCALES: Record<Locale, string> = { en: "en_US", it: "it_IT" };

export function formatBlogDate(date: string, locale: Locale, month: "short" | "long") {
  return new Date(date).toLocaleDateString(DATE_LOCALES[locale], {
    year: "numeric",
    month,
    day: "numeric",
    timeZone: "UTC",
  });
}
