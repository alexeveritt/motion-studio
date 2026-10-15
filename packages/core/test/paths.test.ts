import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { assertSafeSegment, PathPolicy } from "../src/paths.ts";

let root: string;
let outside: string;
let policy: PathPolicy;

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "motion-studio-paths-"));
  root = path.join(base, "workspace");
  outside = path.join(base, "outside");
  await mkdir(path.join(root, "project/assets"), { recursive: true });
  await mkdir(outside);
  policy = new PathPolicy([root]);
});

describe("assertSafeSegment", () => {
  it.each(["logo.png", "brief.md", "a b", "Crème.png"])("accepts %j", (segment) => {
    expect(() => assertSafeSegment(segment)).not.toThrow();
  });

  it.each([
    "",
    ".",
    "..",
    ".env",
    "a/b",
    "a\\b",
    "../x",
    "a\u0000b",
    "a\nb",
    "evil\u202egnp.exe",
    "x".repeat(256),
  ])("rejects %j", (segment) => {
    expect(() => assertSafeSegment(segment)).toThrow(
      expect.objectContaining({ code: "UNSAFE_PATH" }),
    );
  });
});

describe("PathPolicy", () => {
  it("resolves safe segments beneath a root", () => {
    expect(policy.resolve(root, "project", "assets", "logo.png")).toBe(
      path.join(root, "project/assets/logo.png"),
    );
    expect(policy.resolveRelative(path.join(root, "project"), "brand/brand.md")).toBe(
      path.join(root, "project/brand/brand.md"),
    );
  });

  it.each([["../outside"], ["project/../../outside"], ["/etc/passwd"], ["project//x"]])(
    "rejects traversal in relative path %j",
    (relative) => {
      expect(() => policy.resolveRelative(root, relative)).toThrow(
        expect.objectContaining({ code: "UNSAFE_PATH" }),
      );
    },
  );

  it("rejects bases outside every root", () => {
    expect(() => policy.resolve(outside, "file.txt")).toThrow(
      expect.objectContaining({ code: "UNSAFE_PATH" }),
    );
    expect(() => policy.assertAllowed(path.join(root, ".."))).toThrow();
  });

  it("rejects a sibling folder that merely shares the root's prefix", async () => {
    const sibling = `${root}-evil`;
    await mkdir(sibling);
    expect(() => policy.assertAllowed(path.join(sibling, "x"))).toThrow(
      expect.objectContaining({ code: "UNSAFE_PATH" }),
    );
  });

  it("rejects paths through a symlink that escapes the root", async () => {
    await symlink(outside, path.join(root, "project/escape"));
    expect(() => policy.resolve(root, "project", "escape", "file.txt")).toThrow(
      expect.objectContaining({ code: "UNSAFE_PATH" }),
    );
  });

  it("rejects symlinks even when they point inside the root", async () => {
    await symlink(path.join(root, "project/assets"), path.join(root, "project/alias"));
    expect(() => policy.resolve(root, "project", "alias", "logo.png")).toThrow(
      expect.objectContaining({ code: "UNSAFE_PATH" }),
    );
  });

  it("allows paths that do not exist yet", () => {
    expect(policy.resolve(root, "new-project", "brief.md")).toBe(
      path.join(root, "new-project/brief.md"),
    );
  });

  it("requires absolute roots", () => {
    expect(() => new PathPolicy(["relative/root"])).toThrow();
  });
});
