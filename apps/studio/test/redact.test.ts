import { describe, expect, it } from "vitest";
import { redactPaths } from "../src/lib/client/redact.ts";

describe("redactPaths", () => {
  it.each([
    [
      "Failed to fetch /@fs/Users/alex/code/motion-studio/workspace/projects/a/src/composition.tsx",
      "Failed to fetch workspace/projects/a/src/composition.tsx",
    ],
    [
      "at file:///home/me/repo/packages/motion-runtime/src/assets.tsx:12:3",
      "at packages/motion-runtime/src/assets.tsx:12:3",
    ],
    [
      "Error in /Users/x/repo/.motion-studio/tmp/e2e/projects/p/x.tsx",
      "Error in .motion-studio/tmp/e2e/projects/p/x.tsx",
    ],
    ["Plain message with no paths", "Plain message with no paths"],
  ])("%s", (input, expected) => {
    expect(redactPaths(input)).toBe(expected);
  });
});
