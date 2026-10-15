export type DiffLine = { op: "same" | "add" | "remove"; text: string };

/** Above this many cells the LCS table is skipped and the whole text is shown as replaced. */
const MAX_CELLS = 4_000_000;

/** Line-based diff (longest common subsequence). Inputs are small Markdown documents. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ op: "remove" as const, text })),
      ...b.map((text) => ({ op: "add" as const, text })),
    ];
  }

  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i] === b[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ op: "same", text: a[i]! });
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      result.push({ op: "remove", text: a[i++]! });
    } else {
      result.push({ op: "add", text: b[j++]! });
    }
  }
  while (i < a.length) result.push({ op: "remove", text: a[i++]! });
  while (j < b.length) result.push({ op: "add", text: b[j++]! });
  return result;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
