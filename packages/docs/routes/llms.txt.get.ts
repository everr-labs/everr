import { llms } from "fumadocs-core/source";
import { source } from "../src/lib/source";
import { markdownDocsLinks, textResponse } from "../src/lib/llms";

export default function handler() {
  return textResponse(markdownDocsLinks(llms(source).index()));
}
