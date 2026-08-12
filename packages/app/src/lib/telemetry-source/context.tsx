import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createCloudSqlClient } from "./cloud";
import { createLocalSqlClient } from "./local";
import { probeLocalCollector } from "./probe";
import { readStoredSource, writeStoredSource } from "./storage";
import type { SqlClient, TelemetrySourceKind } from "./types";

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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
  // Cloud on the server and on first paint, so server-rendered markup always
  // hydrates against the same value.
  const [kind, setKindState] = useState<TelemetrySourceKind>("cloud");
  const [localOrigin, setLocalOrigin] = useState<string | null>(null);
  const [probed, setProbed] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const stored = readStoredSource();
    if (stored) setKindState(stored);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    probeLocalCollector(controller.signal).then((origin) => {
      if (controller.signal.aborted) return;
      setLocalOrigin(origin);
      setProbed(true);
    });
    return () => controller.abort();
  }, []);

  const cloudClient = useMemo(() => createCloudSqlClient(), []);
  const localClient = useMemo(
    () => (localOrigin ? createLocalSqlClient(localOrigin) : null),
    [localOrigin],
  );

  const value = useMemo<TelemetrySourceContextValue>(() => {
    // A stored preference for Local must not strand the app on a backend that
    // is not answering: fall back to cloud and let the banner explain.
    const effective = kind === "local" && localClient ? "local" : "cloud";
    return {
      kind: effective,
      sqlClient:
        effective === "local" && localClient ? localClient : cloudClient,
      setKind: (next) => {
        setKindState(next);
        writeStoredSource(next);
      },
      localAvailable: localClient !== null,
      localUnreachable: kind === "local" && probed && localClient === null,
    };
  }, [kind, localClient, cloudClient, probed]);

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
