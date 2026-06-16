import type { Attributes } from "@opentelemetry/api";
import type { Client } from "./client.js";

export type Mechanism =
  | "uncaughtException"
  | "unhandledrejection"
  | "onerror"
  | "browserapi"
  | "express"
  | "fastify"
  | "react"
  | "manual";

export type ErrorSeverity = "debug" | "info" | "warn" | "error" | "fatal";

export interface ErrorEvent {
  error: unknown;
  message: string;
  severity: ErrorSeverity;
  mechanism: Mechanism;
  handled: boolean;
  attributes: Attributes;
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
  onFatal?: "exit" | "continue";
}
