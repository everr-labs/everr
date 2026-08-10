// The consent decision for the analytics. It is in a first-party cookie and not
// in localStorage. Thus the server can read it during the SSR. Then the server
// makes the markup with the correct state of the banner, and the banner does not
// change after the hydration.

export const CONSENT_COOKIE = "everr.consent";

export type ConsentDecision = "granted" | "denied";

export function isConsentDecision(
  value: string | undefined,
): value is ConsentDecision {
  return value === "granted" || value === "denied";
}

/**
 * Reads the decision from `document.cookie`. This operates in the browser only.
 * The SSR code reads the same cookie with the `getCookie` function of the
 * server.
 */
export function readConsent(): ConsentDecision | undefined {
  if (typeof document === "undefined") return undefined;
  const value = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  return isConsentDecision(value) ? value : undefined;
}
