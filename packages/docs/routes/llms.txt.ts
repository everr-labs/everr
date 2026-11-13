import { textResponse } from "../src/lib/llms";
import { buildLlmsTxt } from "../src/lib/markdown-pages";

export default function handler() {
  return textResponse(buildLlmsTxt());
}
