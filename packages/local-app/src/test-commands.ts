import { vi } from "vite-plus/test";

export function mockCommands(handler: (command: string, args: Record<string, unknown>) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      try {
        if (typeof init.body !== "string") throw new TypeError("Expected a text request body");
        const result = await handler(url.split("/").at(-1) ?? "", JSON.parse(init.body));
        return new Response(JSON.stringify(result ?? null), { status: 200 });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error) }), {
          status: 500,
        });
      }
    }),
  );
}
