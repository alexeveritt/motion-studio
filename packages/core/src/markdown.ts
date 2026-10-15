export type SectionStatus = { heading: string; filled: boolean };

/**
 * Report which level-two sections of a Markdown document contain any text.
 * Used to show how complete a context file or brief is.
 */
export function sectionCompleteness(markdown: string): SectionStatus[] {
  const sections: SectionStatus[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
    const heading = !inFence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      sections.push({ heading: heading[1]!, filled: false });
    } else if (sections.length > 0 && line.trim() !== "" && !/^#\s/.test(line)) {
      sections[sections.length - 1]!.filled = true;
    }
  }
  return sections;
}
