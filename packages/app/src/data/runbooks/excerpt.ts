/** A plain-text excerpt of markdown for card previews: strips the common
 * markdown syntax, collapses whitespace, and truncates with an ellipsis. */
export function markdownExcerpt(inline: string, maxChars = 280): string {
  const text = inline
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/[#>*_`~|-]/g, " ") // residual markdown punctuation
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars
    ? `${text.slice(0, maxChars).trimEnd()}…`
    : text;
}
