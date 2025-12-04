import { describe, it, expect } from "vitest";
import {
  parseUnifiedDiff,
  applyDiff,
  applyUnifiedDiff,
  applyPatch,
  isUnifiedDiff,
} from "./diff";

describe("parseUnifiedDiff", () => {
  it("parses a simple unified diff", () => {
    const diff = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

    const parsed = parseUnifiedDiff(diff);

    expect(parsed.oldPath).toBe("test.txt");
    expect(parsed.newPath).toBe("test.txt");
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].oldStart).toBe(1);
    expect(parsed.hunks[0].oldCount).toBe(3);
    expect(parsed.hunks[0].newStart).toBe(1);
    expect(parsed.hunks[0].newCount).toBe(4);
  });

  it("parses a diff with deletions", () => {
    const diff = `@@ -1,4 +1,3 @@
 line 1
-removed line
 line 2
 line 3`;

    const parsed = parseUnifiedDiff(diff);

    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].lines).toContain("-removed line");
  });

  it("parses multiple hunks", () => {
    const diff = `@@ -1,3 +1,4 @@
 line 1
+added line 1
 line 2
 line 3
@@ -10,3 +11,4 @@
 line 10
+added line 2
 line 11
 line 12`;

    const parsed = parseUnifiedDiff(diff);

    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0].oldStart).toBe(1);
    expect(parsed.hunks[1].oldStart).toBe(10);
  });
});

describe("applyDiff", () => {
  it("applies a simple addition", () => {
    const original = `line 1
line 2
line 3`;

    const diff = parseUnifiedDiff(`@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`);

    const result = applyDiff(original, diff);

    expect(result.success).toBe(true);
    expect(result.content).toBe(`line 1
new line
line 2
line 3`);
  });

  it("applies a simple deletion", () => {
    const original = `line 1
to delete
line 2
line 3`;

    const diff = parseUnifiedDiff(`@@ -1,4 +1,3 @@
 line 1
-to delete
 line 2
 line 3`);

    const result = applyDiff(original, diff);

    expect(result.success).toBe(true);
    expect(result.content).toBe(`line 1
line 2
line 3`);
  });

  it("applies a replacement", () => {
    const original = `line 1
old line
line 3`;

    const diff = parseUnifiedDiff(`@@ -1,3 +1,3 @@
 line 1
-old line
+new line
 line 3`);

    const result = applyDiff(original, diff);

    expect(result.success).toBe(true);
    expect(result.content).toBe(`line 1
new line
line 3`);
  });
});

describe("applyUnifiedDiff", () => {
  it("applies a full unified diff string", () => {
    const original = `function hello() {
  console.log("Hello");
}`;

    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 function hello() {
   console.log("Hello");
+  console.log("World");
 }`;

    const result = applyUnifiedDiff(original, diff);

    expect(result.success).toBe(true);
    expect(result.content).toContain('console.log("World")');
  });
});

describe("isUnifiedDiff", () => {
  it("returns true for valid unified diff", () => {
    expect(isUnifiedDiff("@@ -1,3 +1,4 @@\n content")).toBe(true);
  });

  it("returns false for non-diff content", () => {
    expect(isUnifiedDiff("just some text")).toBe(false);
    expect(isUnifiedDiff("replace:new content")).toBe(false);
  });
});

describe("applyPatch", () => {
  it("handles replace: prefix", () => {
    const result = applyPatch("original", "replace:new content");

    expect(result.success).toBe(true);
    expect(result.content).toBe("new content");
  });

  it("applies unified diff when detected", () => {
    const original = "line 1\nline 2\nline 3";
    const patch = `@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

    const result = applyPatch(original, patch);

    expect(result.success).toBe(true);
    expect(result.content).toContain("new line");
  });

  it("appends content for non-diff format", () => {
    const result = applyPatch("original", "appended content");

    expect(result.success).toBe(true);
    expect(result.content).toBe("original\nappended content");
    expect(result.warnings).toBeDefined();
  });
});
