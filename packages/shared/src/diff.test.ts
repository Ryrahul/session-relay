import { describe, expect, it } from "vitest";
import { diffStats, splitDiff } from "./diff.js";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 export function add(a, b) {
-  return a - b;
+  return a + b;
 }
diff --git a/new.md b/new.md
new file mode 100644
--- /dev/null
+++ b/new.md
@@ -0,0 +1,2 @@
+# New
+line
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;

describe("diffs", () => {
  it("splits a git diff into files with counts", () => {
    const files = splitDiff(DIFF);
    expect(files.map((f) => [f.path, f.additions, f.deletions, f.binary])).toEqual([
      ["src/a.ts", 1, 1, false],
      ["new.md", 2, 0, false],
      ["img.png", 0, 0, true],
    ]);
    expect(files[0]!.patch.startsWith("diff --git a/src/a.ts")).toBe(true);
    expect(diffStats(DIFF)).toEqual({ files: 3, additions: 3, deletions: 1 });
    expect(splitDiff("")).toEqual([]);
  });
});
