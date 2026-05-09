import * as assert from "assert";
import { parseDiff } from "../git/diffProvider";

suite("DiffProvider – parseDiff()", () => {
  test("returns empty array for empty input", () => {
    assert.deepStrictEqual(parseDiff(""), []);
  });

  test("returns empty array for whitespace-only input", () => {
    assert.deepStrictEqual(parseDiff("   \n\n  "), []);
  });

  test("parses single file, single hunk", () => {
    const raw = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index abc..def 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,4 @@",
      " const x = 1;",
      "-const y = 2;",
      "+const y = 3;",
      "+const z = 4;",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].filePath, "src/foo.ts");
    assert.strictEqual(result[0].language, "ts");
    assert.strictEqual(result[0].hunks.length, 1);

    const hunk = result[0].hunks[0];
    assert.deepStrictEqual(hunk.addedLines, ["const y = 3;", "const z = 4;"]);
    assert.deepStrictEqual(hunk.removedLines, ["const y = 2;"]);
    assert.deepStrictEqual(hunk.context, ["const x = 1;"]);
  });

  test("+++ and --- lines are not treated as added/removed content", () => {
    const raw = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,1 +1,1 @@",
      "+import x from 'lib';",
    ].join("\n");

    const result = parseDiff(raw);
    const hunk = result[0].hunks[0];
    assert.strictEqual(hunk.addedLines.length, 1);
    assert.strictEqual(hunk.addedLines[0], "import x from 'lib';");
    assert.strictEqual(hunk.removedLines.length, 0);
  });

  test("parses multiple files", () => {
    const raw = [
      "diff --git a/a.js b/a.js",
      "@@ -1,1 +1,1 @@",
      "+line in a",
      "diff --git a/b.py b/b.py",
      "@@ -1,1 +1,1 @@",
      "+line in b",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].filePath, "a.js");
    assert.strictEqual(result[0].language, "js");
    assert.strictEqual(result[1].filePath, "b.py");
    assert.strictEqual(result[1].language, "py");
  });

  test("parses multiple hunks in a single file", () => {
    const raw = [
      "diff --git a/src/multi.ts b/src/multi.ts",
      "@@ -1,2 +1,2 @@",
      "-old line 1",
      "+new line 1",
      "@@ -10,2 +10,2 @@",
      "-old line 10",
      "+new line 10",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result[0].hunks.length, 2);
    assert.strictEqual(result[0].hunks[0].addedLines[0], "new line 1");
    assert.strictEqual(result[0].hunks[0].removedLines[0], "old line 1");
    assert.strictEqual(result[0].hunks[1].addedLines[0], "new line 10");
    assert.strictEqual(result[0].hunks[1].removedLines[0], "old line 10");
  });

  test("assigns 'text' language for files without extension", () => {
    const raw = [
      "diff --git a/Makefile b/Makefile",
      "@@ -1,1 +1,1 @@",
      "+all: build",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result[0].language, "text");
  });

  test("uses b-side path (destination) from diff --git header", () => {
    const raw = [
      "diff --git a/old/path.ts b/new/path.ts",
      "@@ -1,1 +1,1 @@",
      "+x",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result[0].filePath, "new/path.ts");
  });

  test("file with no hunks produces empty hunks array", () => {
    const raw = [
      "diff --git a/src/empty.ts b/src/empty.ts",
      "index abc..def 100644",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].hunks, []);
  });

  test("strips leading +/- prefix but preserves inner whitespace", () => {
    const raw = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "@@ -1,1 +1,1 @@",
      "+  indented added line",
      "-  indented removed line",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result[0].hunks[0].addedLines[0], "  indented added line");
    assert.strictEqual(result[0].hunks[0].removedLines[0], "  indented removed line");
  });

  test("hunk header is captured verbatim", () => {
    const header = "@@ -10,6 +10,7 @@ export function foo() {";
    const raw = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      header,
      "+x",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result[0].hunks[0].header, header);
  });

  test("lines before first diff --git header are ignored", () => {
    const raw = [
      "some preamble line",
      "another preamble",
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "+x",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result.length, 1);
  });

  test("content lines before first hunk (e.g. index/mode) are ignored", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index abc..def 100644",
      "new file mode 100644",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
    ].join("\n");

    const result = parseDiff(raw);
    assert.strictEqual(result[0].hunks[0].addedLines.length, 2);
  });

  test("detects various file extensions as language", () => {
    const cases: Array<[string, string]> = [
      ["src/index.tsx", "tsx"],
      ["styles/main.css", "css"],
      ["README.md", "md"],
      ["config.json", "json"],
    ];

    for (const [filePath, expectedLang] of cases) {
      const raw = [
        `diff --git a/${filePath} b/${filePath}`,
        "@@ -1,1 +1,1 @@",
        "+x",
      ].join("\n");
      const result = parseDiff(raw);
      assert.strictEqual(result[0].language, expectedLang, `language for ${filePath}`);
    }
  });
});
