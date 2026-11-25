// Mermaid reads a diagram's title from a YAML frontmatter block at the top of the chart
export function mermaidTitle(chart: string): string | undefined {
  const block = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(chart)?.[1];
  const title = block && /^title:[ \t]*(.+?)[ \t]*$/m.exec(block)?.[1];
  return title ? title.replace(/^(["'])(.*)\1$/, "$2") : undefined;
}
