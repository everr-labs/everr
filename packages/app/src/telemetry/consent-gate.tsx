import { revoke, setPersistence } from "@everr/otel-web";
import { ConsentBanner } from "@everr/ui/components/consent-banner";
import { ConsentSettingsDialog } from "@everr/ui/components/consent-settings-dialog";
import { createContext, type ReactNode, useContext, useState } from "react";
import { CONSENT_COOKIE, type ConsentDecision } from "@/telemetry/consent";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// How anything nested under `ConsentGate` (e.g. the "Cookie preferences" item
// in the user menu) reopens the settings dialog it owns, without prop
// drilling through the whole route tree.
const OpenConsentSettingsContext = createContext<(() => void) | undefined>(
  undefined,
);

/** Reopens the consent settings dialog; only valid under `ConsentGate`. */
export function useOpenConsentSettings(): () => void {
  const open = useContext(OpenConsentSettingsContext);
  if (!open) {
    throw new Error("useOpenConsentSettings must be used within ConsentGate");
  }
  return open;
}

function storeConsent(decision: ConsentDecision): void {
  // The Cookie Store API (the lint's suggested alternative) isn't supported
  // in Safari or Firefox; a synchronous first-party write is fine here.
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API has no cross-browser support yet
  document.cookie = `${CONSENT_COOKIE}=${decision}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

/**
 * Mounted once at the app root. `initialConsent` comes from the SSR-read
 * cookie (see `__root.tsx`), so the server-rendered markup already reflects
 * it and there's no post-hydration flash either way.
 *
 * A decision switches the live WebSDK in place, no reload: granting calls
 * the SDK's `setPersistence("localStorage")` so the running client upgrades
 * to durable ids (the in-flight session carries over), and withdrawing
 * calls `revoke()`, which deletes the stored visitor/session/user ids and
 * drops the client back to memory-only. The boot in `telemetry/client.ts`
 * only picks the *initial* persistence from the cookie.
 */
export function ConsentGate({
  initialConsent,
  children,
}: {
  initialConsent: ConsentDecision | undefined;
  children: ReactNode;
}) {
  const [consent, setConsent] = useState(initialConsent);
  const [dismissed, setDismissed] = useState(initialConsent !== undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Only choice this dialog actually gates (Essential is always on); seeded
  // from what's actually running so reopening it later reflects reality
  // instead of resetting to "nothing decided yet".
  const [analyticsEnabled, setAnalyticsEnabled] = useState(
    initialConsent === "granted",
  );

  const decide = (next: ConsentDecision) => {
    storeConsent(next);
    setSettingsOpen(false);
    setDismissed(true);
    setAnalyticsEnabled(next === "granted");
    // Re-confirming what's already running (memory persistence when nothing
    // was decided yet counts as denied) is a no-op for the SDK.
    if (next === (consent ?? "denied")) return;
    setConsent(next);
    if (next === "granted") {
      setPersistence("localStorage");
    } else {
      revoke();
    }
  };

  return (
    <OpenConsentSettingsContext.Provider value={() => setSettingsOpen(true)}>
      {children}
      <ConsentBanner
        open={!dismissed && !settingsOpen}
        onAcceptAll={() => decide("granted")}
        onDeny={() => decide("denied")}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ConsentSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        analyticsEnabled={analyticsEnabled}
        onAnalyticsChange={setAnalyticsEnabled}
        onDeny={() => decide("denied")}
        onAcceptAll={() => decide("granted")}
        onSave={() => decide(analyticsEnabled ? "granted" : "denied")}
      />
    </OpenConsentSettingsContext.Provider>
  );
}
