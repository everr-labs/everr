import type { Attributes } from "@opentelemetry/api";
import { getClient } from "./core.js";

interface ExpressLikeRequest {
  method: string;
  originalUrl?: string;
  url?: string;
  protocol?: string;
  route?: { path?: string };
  get?(name: string): string | undefined;
}

type ExpressLikeNext = (err?: unknown) => void;

export function errorHandler() {
  return (err: unknown, req: ExpressLikeRequest, _res: unknown, next: ExpressLikeNext): void => {
    const attributes: Attributes = {
      "http.request.method": req.method,
      "url.full": fullUrl(req),
      ...(req.route?.path ? { "http.route": req.route.path } : {}),
    };
    getClient()?.capture({
      error: err,
      mechanism: "express",
      handled: true,
      severity: "error",
      attributes,
    });
    next(err);
  };
}

function fullUrl(req: ExpressLikeRequest): string {
  const path = req.originalUrl ?? req.url ?? "";
  const host = req.get?.("host");
  return host ? `${req.protocol ?? "http"}://${host}${path}` : path;
}
