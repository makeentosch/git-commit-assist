import * as assert from "assert";
import {
  extractLibraryReferencesFromAddedLines,
  extractLibraryReferencesFromDiff,
  extractLibraryReferencesFromRawDiff,
} from "../analyzer/libraryReferences";
import { StagedDiff } from "../models/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AddedLine = { importStatement: string; filePath: string };

function line(importStatement: string, filePath = "src/a.ts"): AddedLine {
  return { importStatement, filePath };
}

function makeDiff(filePath: string, ...addedLines: string[]): StagedDiff {
  return {
    raw: "",
    files: [
      {
        filePath,
        language: "ts",
        hunks: [
          {
            header: "@@ -1,1 +1,1 @@",
            addedLines,
            removedLines: [],
            context: [],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// extractLibraryReferencesFromAddedLines
// ---------------------------------------------------------------------------

suite("LibraryReferences – extractLibraryReferencesFromAddedLines()", () => {
  test("extracts ES6 single-quote import", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("import foo from 'lodash';"),
    ]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "lodash");
    assert.strictEqual(result[0].filePath, "src/a.ts");
    assert.strictEqual(result[0].importStatement, "import foo from 'lodash';");
  });

  test("extracts ES6 double-quote import", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line('import foo from "react";'),
    ]);
    assert.strictEqual(result[0].name, "react");
  });

  test("extracts named ES6 import", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("import { useState, useEffect } from 'react';"),
    ]);
    assert.strictEqual(result[0].name, "react");
  });

  test("extracts scoped package (@scope/pkg)", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("import { GoogleGenerativeAI } from '@google/generative-ai';"),
    ]);
    assert.strictEqual(result[0].name, "@google/generative-ai");
  });

  test("extracts deeply-scoped package (@scope/pkg/sub)", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("import x from '@aws-sdk/client-s3/dist';"),
    ]);
    assert.strictEqual(result[0].name, "@aws-sdk/client-s3/dist");
  });

  test("extracts side-effect import", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("import 'reflect-metadata';"),
    ]);
    assert.strictEqual(result[0].name, "reflect-metadata");
  });

  test("extracts CommonJS require()", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("const path = require('path');"),
    ]);
    assert.strictEqual(result[0].name, "path");
  });

  test("extracts CommonJS require() with double quotes", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line('const _ = require("lodash");'),
    ]);
    assert.strictEqual(result[0].name, "lodash");
  });

  test("filters out relative imports starting with '.'", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("import x from './utils';"),
      line("import y from '../models/types';"),
    ]);
    assert.deepStrictEqual(result, []);
  });

  test("filters out absolute path imports starting with '/'", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("import x from '/usr/local/lib';"),
    ]);
    assert.deepStrictEqual(result, []);
  });

  test("deduplicates identical file+library+statement triplet", () => {
    const l = line("import x from 'lodash';");
    const result = extractLibraryReferencesFromAddedLines([l, l, l]);
    assert.strictEqual(result.length, 1);
  });

  test("does NOT deduplicate same library from different files", () => {
    const result = extractLibraryReferencesFromAddedLines([
      { importStatement: "import x from 'lodash';", filePath: "src/a.ts" },
      { importStatement: "import x from 'lodash';", filePath: "src/b.ts" },
    ]);
    assert.strictEqual(result.length, 2);
  });

  test("treats different import statements for same library as distinct entries", () => {
    const result = extractLibraryReferencesFromAddedLines([
      { importStatement: "import { map } from 'lodash';", filePath: "src/a.ts" },
      { importStatement: "import { filter } from 'lodash';", filePath: "src/a.ts" },
    ]);
    assert.strictEqual(result.length, 2);
  });

  test("returns empty array for non-import lines", () => {
    const result = extractLibraryReferencesFromAddedLines([
      line("const x = 1 + 2;"),
      line("// comment about 'lodash'"),
      line("console.log('hello');"),
    ]);
    assert.deepStrictEqual(result, []);
  });

  test("returns empty array for empty input", () => {
    assert.deepStrictEqual(extractLibraryReferencesFromAddedLines([]), []);
  });
});

// ---------------------------------------------------------------------------
// extractLibraryReferencesFromRawDiff
// ---------------------------------------------------------------------------

suite("LibraryReferences – extractLibraryReferencesFromRawDiff()", () => {
  test("extracts only added-line imports (not context or removed)", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " import existing from 'already-there';",
      "+import newLib from 'axios';",
      "-import oldLib from 'superagent';",
    ].join("\n");

    const result = extractLibraryReferencesFromRawDiff(raw);
    const names = result.map((r) => r.name);
    assert.ok(names.includes("axios"), "should extract axios from added line");
    assert.ok(!names.includes("already-there"), "should skip context lines");
    assert.ok(!names.includes("superagent"), "should skip removed lines");
  });

  test("tracks file path per diff --git header", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "+import x from 'lib-a';",
      "diff --git a/src/b.ts b/src/b.ts",
      "@@ -1,1 +1,1 @@",
      "+import y from 'lib-b';",
    ].join("\n");

    const result = extractLibraryReferencesFromRawDiff(raw);
    assert.strictEqual(result.find((r) => r.name === "lib-a")?.filePath, "src/a.ts");
    assert.strictEqual(result.find((r) => r.name === "lib-b")?.filePath, "src/b.ts");
  });

  test("ignores +++ meta line (not treated as added content)", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "+import x from 'lodash';",
    ].join("\n");

    const result = extractLibraryReferencesFromRawDiff(raw);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "lodash");
  });

  test("filters relative imports from raw diff", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      "+import x from 'external-lib';",
      "+import y from './relative';",
    ].join("\n");

    const result = extractLibraryReferencesFromRawDiff(raw);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "external-lib");
  });

  test("returns empty array for diff with no added import lines", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/a.ts",
      "@@ -1,1 +0,0 @@",
      "-import x from 'removed-lib';",
    ].join("\n");

    assert.deepStrictEqual(extractLibraryReferencesFromRawDiff(raw), []);
  });

  test("returns empty array for empty string", () => {
    assert.deepStrictEqual(extractLibraryReferencesFromRawDiff(""), []);
  });
});

// ---------------------------------------------------------------------------
// extractLibraryReferencesFromDiff
// ---------------------------------------------------------------------------

suite("LibraryReferences – extractLibraryReferencesFromDiff()", () => {
  test("extracts library from StagedDiff structure", () => {
    const diff = makeDiff("src/app.ts", "import { debounce } from 'lodash';");
    const result = extractLibraryReferencesFromDiff(diff);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "lodash");
    assert.strictEqual(result[0].filePath, "src/app.ts");
  });

  test("extracts scoped package from StagedDiff", () => {
    const diff = makeDiff(
      "src/ai.ts",
      "import { GoogleGenerativeAI } from '@google/generative-ai';",
    );
    const result = extractLibraryReferencesFromDiff(diff);
    assert.strictEqual(result[0].name, "@google/generative-ai");
  });

  test("filters relative imports from StagedDiff", () => {
    const diff = makeDiff(
      "src/app.ts",
      "import x from './local';",
      "import y from '../models';",
    );
    assert.deepStrictEqual(extractLibraryReferencesFromDiff(diff), []);
  });

  test("returns empty for diff with no added lines", () => {
    const diff: StagedDiff = {
      raw: "",
      files: [
        {
          filePath: "src/a.ts",
          language: "ts",
          hunks: [
            {
              header: "@@ -1,1 +0,0 @@",
              addedLines: [],
              removedLines: ["import x from 'lodash';"],
              context: [],
            },
          ],
        },
      ],
    };
    assert.deepStrictEqual(extractLibraryReferencesFromDiff(diff), []);
  });

  test("collects imports across multiple files and hunks", () => {
    const diff: StagedDiff = {
      raw: "",
      files: [
        {
          filePath: "src/a.ts",
          language: "ts",
          hunks: [
            {
              header: "@@ -1,1 +1,1 @@",
              addedLines: ["import axios from 'axios';"],
              removedLines: [],
              context: [],
            },
            {
              header: "@@ -10,1 +10,1 @@",
              addedLines: ["import { debounce } from 'lodash';"],
              removedLines: [],
              context: [],
            },
          ],
        },
        {
          filePath: "src/b.ts",
          language: "ts",
          hunks: [
            {
              header: "@@ -1,1 +1,1 @@",
              addedLines: ["import { format } from 'date-fns';"],
              removedLines: [],
              context: [],
            },
          ],
        },
      ],
    };

    const result = extractLibraryReferencesFromDiff(diff);
    const names = result.map((r) => r.name);
    assert.ok(names.includes("axios"));
    assert.ok(names.includes("lodash"));
    assert.ok(names.includes("date-fns"));
    assert.strictEqual(result.length, 3);
  });

  test("returns empty array for diff with no files", () => {
    const diff: StagedDiff = { raw: "", files: [] };
    assert.deepStrictEqual(extractLibraryReferencesFromDiff(diff), []);
  });
});
