import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTelemetrySourceParam } from "@/hooks/use-telemetry-source-param";
import { createCloudSqlClient } from "./cloud";
import { createLocalSqlClient } from "./local";
import { probeLocalCollector } from "./probe";
import type { SqlClient, TelemetrySourceKind } from "./types";

/**
 * How often the collector is re-probed. Loopback with a short timeout, so this
 * is cheap; the interval only has to be quick enough that starting or stopping
 * the collector is noticed without the user reloading.
 */
const PROBE_INTERVAL_MS = 15_000;

interface TelemetrySourceContextValue {
  /** Which backend panels currently read from. */
  kind: TelemetrySourceKind;
  /** The client to build a repository with. */
  sqlClient: SqlClient;
  setKind: (kind: TelemetrySourceKind) => void;
  /** A collector answered the probe, so Local is offerable. */
  localAvailable: boolean;
  /**
   * Local is selected but the collector has stopped answering. The shell shows
   * one banner for this rather than letting every panel fail on its own.
   */
  localUnreachable: boolean;
}

const TelemetrySourceContext =
  createContext<TelemetrySourceContextValue | null>(null);

export function TelemetrySourceProvider({ children }: { children: ReactNode }) {
  // The URL is the store, so the selection is already correct during SSR and
  // there is no first-paint default to hydrate against.
  const { kind, setKind } = useTelemetrySourceParam();
  const [localOrigin, setLocalOrigin] = useState<string | null>(null);
  const [probed, setProbed] = useState(false);

  // Re-probed on an interval, not just at mount: a collector can be started
  // after the page loads, or stopped while it is open, and both directions have
  // to be noticed without a reload.
  useEffect(() => {
    const controller = new AbortController();

    async function check() {
      const origin = await probeLocalCollector(controller.signal);
      if (controller.signal.aborted) return;
      setLocalOrigin(origin);
      setProbed(true);
    }

    void check();
    const timer = setInterval(() => void check(), PROBE_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  const cloudClient = useMemo(() => createCloudSqlClient(), []);
  const localClient = useMemo(
    () => (localOrigin ? createLocalSqlClient(localOrigin) : null),
    [localOrigin],
  );

  const value = useMemo<TelemetrySourceContextValue>(() => {
    // A `?source=local` URL must not strand the app on a backend that is not
    // answering: fall back to cloud and let the banner explain. The param is
    // left alone, so the selection returns by itself once the collector is back.
    const effective = kind === "local" && localClient ? "local" : "cloud";
    return {
      kind: effective,
      sqlClient:
        effective === "local" && localClient ? localClient : cloudClient,
      setKind,
      localAvailable: localClient !== null,
      localUnreachable: kind === "local" && probed && localClient === null,
    };
  }, [kind, setKind, localClient, cloudClient, probed]);

  return (
    <TelemetrySourceContext.Provider value={value}>
      {children}
    </TelemetrySourceContext.Provider>
  );
}

export function useTelemetrySource(): TelemetrySourceContextValue {
  const context = useContext(TelemetrySourceContext);
  if (!context) {
    throw new Error(
      "useTelemetrySource must be used within a TelemetrySourceProvider",
    );
  }
  return context;
}
