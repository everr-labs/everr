import { revoke } from "@everr/otel-web";
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
  // in Safari or Firefox; a synchronous first-party write is what's needed
  // here anyway, ahead of the accept path's reload.
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API has no cross-browser support yet
  document.cookie = `${CONSENT_COOKIE}=${decision}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

/**
 * Mounted once at the app root. `initialConsent` comes from the SSR-read
 * cookie (see `__root.tsx`), so the server-rendered markup already reflects
 * it and there's no post-hydration flash either way, and stays accurate for
 * the tab's whole life: any change here reloads, so it's never stale.
 *
 * A no-op decision (re-confirming what's already running) just closes the
 * UI. An actual change reloads: @everr/otel-web's `init()` picks its
 * persistence (localStorage vs. memory) once, at telemetry boot
 * (`telemetry/client.ts`), and never upgrades or downgrades a live client in
 * place. Withdrawing consent additionally calls the SDK's `revoke()` first,
 * so the durable visitor/session/user ids actually get deleted from storage
 * instead of merely being ignored on the next boot.
 */
export function ConsentGate({
  initialConsent,
  children,
}: {
  initialConsent: ConsentDecision | undefined;
  children: ReactNode;
}) {
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
    // Re-confirming what's already running (memory persistence when nothing
    // was decided yet) just closes the UI; an actual change reloads so
    // init() reboots with the right persistence. Downgrading from granted
    // deletes the durable ids first.
    if (next === (initialConsent ?? "denied")) {
      setSettingsOpen(false);
      setDismissed(true);
      return;
    }
    if (initialConsent === "granted") revoke();
    location.reload();
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
