type SSEStream = {
  sendEvent: (data: object) => void;
  close: () => void;
  response: () => Response;
};

export function createSSEStream(request: Request): SSEStream {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;

  function sendEvent(data: object) {
    if (closed) return;
    writer
      .write(
        encoder.encode(`event: message\ndata: ${JSON.stringify(data)}\n\n`),
      )
      .catch(() => {});
  }

  const heartbeatInterval = setInterval(() => {
    sendEvent({ type: "ping" });
  }, 30_000);

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatInterval);
    writer.close().catch(() => {});
  }

  request.signal.addEventListener("abort", close);

  function response() {
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return { sendEvent, close, response };
}
