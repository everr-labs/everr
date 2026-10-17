/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Public (origin-bound, ingest-only) `ek_` key used to send browser error
   * telemetry to Everr. Safe to ship in the client bundle. When unset in a
   * production build, browser error tracking stays off.
   */
  readonly VITE_EVERR_PUBLIC_INGEST_KEY?: string;
  /**
   * OTLP endpoint for browser telemetry. Required in production;
   * development can use the local collector.
   */
  readonly VITE_EVERR_INGEST_ENDPOINT?: string;
}
