import type { Tracer } from "@opentelemetry/api";
import { errorTypeOf } from "../../errors.js";
import type { PropagationTarget } from "./network.js";
import { shouldPropagate, startRequest } from "./request.js";

type RequestState = {
  method: string;
  url: URL;
  finish?: (errorType?: string, cancelled?: boolean) => void;
};

export function startXHR(tracer: Tracer, targets?: PropagationTarget[]) {
  if (typeof XMLHttpRequest === "undefined") return () => {};
  const proto = XMLHttpRequest.prototype;
  const { open, send, setRequestHeader } = proto;
  let requests: WeakMap<XMLHttpRequest, RequestState> | undefined =
    new WeakMap();
  const pending = new Set<() => void>();

  const patchedOpen: typeof open = function (
    this: XMLHttpRequest,
    ...args: [
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ]
  ) {
    const previous = requests?.get(this);
    // A pre-existing DONE callback may reopen before our listener runs.
    // Capture its response before native open resets status and headers.
    if (this.readyState === 4 && this.status) previous?.finish?.();
    requests?.delete(this);
    try {
      requests?.set(this, {
        method: args[0].toUpperCase(),
        url: new URL(String(args[1]), document.baseURI),
      });
    } catch {
      // Instrumentation must not reject a URL the browser accepted.
    }
    try {
      // Install state before open dispatches OPENED: a callback can send there.
      const result = Reflect.apply(open, this, args);
      previous?.finish?.(undefined, true);
      return result;
    } catch (error) {
      if (previous) requests?.set(this, previous);
      else requests?.delete(this);
      throw error;
    }
  };

  const patchedSend: typeof send = function (this: XMLHttpRequest, body) {
    const state = requests?.get(this);
    // Let native XHR handle invalid/duplicate sends without ending an
    // already-running request or creating an extra span.
    if (!state || state.finish || this.readyState !== 1) {
      return send.call(this, body);
    }
    const request = startRequest(tracer, state.method, state.url);
    if (shouldPropagate(state.url, targets)) {
      try {
        setRequestHeader.call(this, "traceparent", request.traceparent);
      } catch {
        // A failed header injection must not prevent the request.
      }
    }

    const events = ["readystatechange", "load", "error", "timeout", "abort"];
    const finish = (errorType?: string, cancelled = false) => {
      if (state.finish !== finish) return;
      for (const event of events)
        this.removeEventListener(event, onEvent, true);
      state.finish = undefined;
      pending.delete(finish);
      // A cleared request map means shutdown: detach without exporting.
      if (requests) {
        request.end(
          cancelled ? undefined : this.status || undefined,
          errorType,
          cancelled ? undefined : this.getResponseHeader("x-everr-route"),
        );
      }
    };
    const onEvent = (event: Event) => {
      // Capture successful DONE before user callbacks can reopen the object.
      // Failures need their terminal event to distinguish timeout from error.
      if (requests?.get(this) !== state || this.readyState !== 4) return;
      if (event.type === "readystatechange" && !this.status) return;
      finish(
        event.type === "error"
          ? "NetworkError"
          : event.type === "timeout"
            ? "TimeoutError"
            : undefined,
      );
    };
    state.finish = finish;
    pending.add(finish);
    for (const event of events) this.addEventListener(event, onEvent, true);
    try {
      return send.call(this, body);
    } catch (error) {
      finish(error instanceof DOMException ? error.name : errorTypeOf(error));
      throw error;
    }
  };

  proto.open = patchedOpen;
  proto.send = patchedSend;
  return () => {
    requests = undefined;
    // Drop unfinished observations on shutdown without aborting application I/O.
    for (const cleanup of pending) cleanup();
    if (proto.open === patchedOpen) proto.open = open;
    if (proto.send === patchedSend) proto.send = send;
  };
}
