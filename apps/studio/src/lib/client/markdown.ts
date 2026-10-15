import MarkdownIt from "markdown-it";

/**
 * Markdown renderer for previews. Raw HTML is disabled (escaped), and
 * markdown-it's link validation blocks javascript:, vbscript: and file: URLs.
 */
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}
