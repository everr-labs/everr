// The stored analytics-consent decision: a first-party cookie (not
// localStorage) so it's readable during SSR, letting the server render the
// banner's correct open/closed state up front instead of flashing it after
// hydration.

export const CONSENT_COOKIE = "everr.consent";

export type ConsentDecision = "granted" | "denied";

export function isConsentDecision(
  value: string | undefined,
): value is ConsentDecision {
  return value === "granted" || value === "denied";
}

/**
 * Reads the stored decision from `document.cookie` (browser only; the SSR
 * path reads the same cookie via the server's `getCookie`).
 */
export function readConsent(): ConsentDecision | undefined {
  if (typeof document === "undefined") return undefined;
  const value = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  return isConsentDecision(value) ? value : undefined;
}
