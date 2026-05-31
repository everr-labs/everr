import { getRequestURL } from "nitro/h3";
import { docsMarkdownResponse } from "../src/lib/llms";
import { source } from "../src/lib/source";

export default function handler(event: Parameters<typeof getRequestURL>[0]) {
  const pathname = getRequestURL(event).searchParams.get("pathname");

  if (!pathname) {
    return new Response("Not found", { status: 404 });
  }

  return docsMarkdownResponse(source, pathname);
}
