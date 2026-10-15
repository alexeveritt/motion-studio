import { describe, expect, it } from "vitest";
import { lineDiff } from "../src/diff.ts";

describe("lineDiff", () => {
  it("marks unchanged, added and removed lines", () => {
    expect(lineDiff("a\nb\nc\n", "a\nc\nd\n")).toEqual([
      { op: "same", text: "a" },
      { op: "remove", text: "b" },
      { op: "same", text: "c" },
      { op: "add", text: "d" },
    ]);
  });

  it("handles empty inputs", () => {
    expect(lineDiff("", "")).toEqual([]);
    expect(lineDiff("", "x")).toEqual([{ op: "add", text: "x" }]);
    expect(lineDiff("x\n", "")).toEqual([{ op: "remove", text: "x" }]);
  });

  it("treats CRLF and LF line endings alike", () => {
    expect(lineDiff("a\r\nb\r\n", "a\nb\n").every((line) => line.op === "same")).toBe(true);
  });
});
