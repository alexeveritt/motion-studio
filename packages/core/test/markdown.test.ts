import { describe, expect, it } from "vitest";
import { sectionCompleteness } from "../src/markdown.ts";

describe("sectionCompleteness", () => {
  it("marks sections with any text as filled", () => {
    const doc = "# Title\n\nIntro\n\n## Objective\nDrive scans\n\n## Audience\n\n## Tone\n- calm\n";
    expect(sectionCompleteness(doc)).toEqual([
      { heading: "Objective", filled: true },
      { heading: "Audience", filled: false },
      { heading: "Tone", filled: true },
    ]);
  });

  it("ignores headings inside code fences", () => {
    expect(sectionCompleteness("## A\n```\n## Not a heading\n```\n")).toEqual([
      { heading: "A", filled: true },
    ]);
  });

  it("returns nothing for documents without sections", () => {
    expect(sectionCompleteness("Just prose")).toEqual([]);
  });
});
