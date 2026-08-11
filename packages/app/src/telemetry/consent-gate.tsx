import { clearIdentity, setPersistence } from "@everr/otel-web";
import { ConsentBanner } from "@everr/ui/components/consent-banner";
import { ConsentSettingsDialog } from "@everr/ui/components/consent-settings-dialog";
import { createContext, type ReactNode, useContext, useState } from "react";
import { CONSENT_COOKIE, type ConsentDecision } from "@/telemetry/consent";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// This lets a component below `ConsentGate` show the settings dialog again. An
// example is the "Cookie preferences" item in the user menu. Thus the app does
// not send a property through all the routes.
const OpenConsentSettingsContext = createContext<(() => void) | undefined>(
  undefined,
);

/** Shows the consent settings dialog again. Use it only below `ConsentGate`. */
export function useOpenConsentSettings(): () => void {
  const open = useContext(OpenConsentSettingsContext);
  if (!open) {
    throw new Error("useOpenConsentSettings must be used within ConsentGate");
  }
  return open;
}

function storeConsent(decision: ConsentDecision): void {
  // Safari and Firefox do not have the Cookie Store API, which the lint rule
  // gives as an alternative. A synchronous write of a first-party cookie is
  // correct here.
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API has no cross-browser support yet
  document.cookie = `${CONSENT_COOKIE}=${decision}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

/**
 * The app shows this component one time, at its root. The `initialConsent`
 * property comes from the cookie that the SSR code reads. Refer to
 * `__root.tsx`. Thus the markup from the server already has the correct state,
 * and the banner does not change after the hydration.
 *
 * A decision changes the current WebSDK, and the page does not reload. When the
 * user gives consent, the code calls `setPersistence("localStorage")` of the
 * SDK. Then the current client uses permanent ids, and the current session
 * continues. When the user removes the consent, the code calls
 * `clearIdentity()`, which deletes the visitor id, the session id, and the user
 * id from the store, and then `setPersistence("memory")`, so the client uses
 * the memory store again. The code in `telemetry/client.ts` only selects the
 * initial store from the cookie.
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
  // This is the only choice that the dialog controls, because the Essential
  // category is always on. The initial value comes from the current condition of
  // the SDK. Thus the dialog shows the true condition when the user opens it
  // again, and it does not show "no decision".
  const [analyticsEnabled, setAnalyticsEnabled] = useState(
    initialConsent === "granted",
  );

  const decide = (next: ConsentDecision) => {
    storeConsent(next);
    setSettingsOpen(false);
    setDismissed(true);
    setAnalyticsEnabled(next === "granted");
    // The user can select the current condition again. Then the SDK does
    // nothing. The memory store, when the user made no decision, is the same as
    // a refusal.
    if (next === (consent ?? "denied")) return;
    setConsent(next);
    if (next === "granted") {
      setPersistence("localStorage");
    } else {
      // The order matters: clearIdentity() deletes the stored ids while the
      // localStorage store is still current, then setPersistence("memory")
      // switches without a write to the refused store.
      clearIdentity();
      setPersistence("memory");
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
