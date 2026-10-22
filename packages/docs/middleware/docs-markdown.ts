import { defineEventHandler, getRequestURL } from "nitro/h3";
import { docsMarkdownResponse } from "../src/lib/llms";
import { source } from "../src/lib/source";

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname;

  if (pathname !== "/docs.md" && !(pathname.startsWith("/docs/") && pathname.endsWith(".md"))) {
    return;
  }

  return docsMarkdownResponse(source, pathname);
});
