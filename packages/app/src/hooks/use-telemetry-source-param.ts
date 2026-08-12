import { useNavigate, useSearch } from "@tanstack/react-router";
import type { TelemetrySourceKind } from "@/lib/telemetry-source/types";

/**
 * The selected panel data source, from the `?source=` param.
 *
 * The URL is the store, the same way the active preview and the explore filters
 * are: it survives a reload, it is retained across navigation by the
 * `_dashboard` layout, and it is shareable and per-tab, so two tabs can sit on
 * different sources at once.
 *
 * Absent means cloud, so a plain URL behaves the way the app always has.
 * Selecting cloud clears the key rather than writing `source=cloud`, which keeps
 * the default out of the URL (and lets `retainSearchParams` refill it).
 */
export function useTelemetrySourceParam(): {
  kind: TelemetrySourceKind;
  setKind: (kind: TelemetrySourceKind) => void;
} {
  const navigate = useNavigate();
  const { source } = useSearch({ from: "/_authenticated/_dashboard" });

  const setKind = (kind: TelemetrySourceKind) => {
    navigate({
      to: ".",
      search: (prev) => ({
        ...prev,
        source: kind === "cloud" ? undefined : kind,
      }),
    });
  };

  return { kind: source ?? "cloud", setKind };
}
