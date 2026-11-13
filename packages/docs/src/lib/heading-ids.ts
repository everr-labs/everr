/**
 * Fumadocs writes each heading's anchor into the processed Markdown as `## Title [#id]`.
 * Agents read that suffix as part of the title, so drop it outside code blocks.
 */
export function stripHeadingIds(markdown: string) {
  let fence: string | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
      if (marker && (!fence || marker.startsWith(fence))) {
        fence = fence ? undefined : marker;
        return line;
      }
      return fence ? line : line.replace(/^(#{1,6} .*?) \[#[^\]\s]+\]\s*$/, "$1");
    })
    .join("\n");
}
