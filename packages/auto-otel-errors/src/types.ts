import type { Attributes } from "@opentelemetry/api";
import type { Client } from "./client.js";

export type Mechanism =
  | "uncaughtException"
  | "unhandledrejection"
  | "onerror"
  | "console"
  | "fetch"
  | "xhr"
  | "express"
  | "fastify"
  | "react"
  | "manual";

export type ConsoleLevel = "error" | "warn";

export interface ErrorEvent {
  error: unknown;
  message: string;
  severity: "error" | "fatal";
  mechanism: Mechanism;
  handled: boolean;
  attributes: Attributes;
}

export interface Breadcrumb {
  timestamp: number;
  category: string;
  message: string;
  level?: string;
  data?: Attributes;
  traceId?: string;
}

export interface BreadcrumbInput {
  category: string;
  message: string;
  level?: string;
  data?: Attributes;
}

export interface Integration {
  name: string;
  setup(client: Client): void;
  teardown?(): void;
}

export interface Options {
  integrations?: Integration[];
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  scrubPatterns?: RegExp[];
  rateLimit?: { count: number; windowMs: number } | false;
  console?: { levels: ConsoleLevel[] } | false;
  network?: {
    captureStatusCodes?: (code: number) => boolean;
    ignoreUrls?: (string | RegExp)[];
  } | false;
  breadcrumbs?:
    | {
        maxEntries?: number;
        console?: boolean;
        network?: boolean;
        dom?: boolean;
      }
    | false;
  onFatal?: "exit" | "continue";
}
