import * as assert from "assert";
import {
  buildDiffCompactionPromptWithDocs,
  buildDiffOverviewPrompt,
} from "../analyzer/prompts/diffOverviewPrompt";
import { DocumentationContext } from "../models/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<DocumentationContext> = {}): DocumentationContext {
  return {
    libraryId: "lib/lib",
    libraryName: "lib",
    content: "some documentation content",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildDiffOverviewPrompt
// ---------------------------------------------------------------------------

suite("Prompt Builders – buildDiffOverviewPrompt()", () => {
  test("contains all three required Russian section headings", () => {
    const prompt = buildDiffOverviewPrompt("compact diff here");
    assert.ok(
      prompt.includes("## Что сделано хорошо"),
      "missing 'Что сделано хорошо'",
    );
    assert.ok(
      prompt.includes("## Что сделано плохо"),
      "missing 'Что сделано плохо'",
    );
    assert.ok(
      prompt.includes("## Что можно улучшить"),
      "missing 'Что можно улучшить'",
    );
  });

  test("embeds the compacted diff verbatim", () => {
    const sentinel = "MY_UNIQUE_COMPACTED_DIFF_CONTENT_XYZ";
    const prompt = buildDiffOverviewPrompt(sentinel);
    assert.ok(prompt.includes(sentinel));
  });

  test("shows fallback text when docs context is empty array", () => {
    const prompt = buildDiffOverviewPrompt("diff", []);
    assert.ok(
      prompt.includes(
        "Контекст документации Context7 не найден или недоступен",
      ),
    );
  });

  test("includes library name and id when docs context is provided", () => {
    const doc = makeDoc({ libraryId: "lodash/lodash", libraryName: "lodash" });
    const prompt = buildDiffOverviewPrompt("diff", [doc]);
    assert.ok(prompt.includes("lodash"));
    assert.ok(prompt.includes("lodash/lodash"));
  });

  test("includes docs content when context is provided", () => {
    const doc = makeDoc({ content: "UNIQUE_DOC_CONTENT_ABC" });
    const prompt = buildDiffOverviewPrompt("diff", [doc]);
    assert.ok(prompt.includes("UNIQUE_DOC_CONTENT_ABC"));
  });

  test("truncates each doc's content to 2500 chars", () => {
    const doc = makeDoc({ content: "x".repeat(5000) });
    const prompt = buildDiffOverviewPrompt("diff", [doc]);
    // If content were not truncated, the 2501st 'x' would appear
    assert.ok(!prompt.includes("x".repeat(2501)));
  });

  test("shows markdown fallback when no markdown context given", () => {
    const prompt = buildDiffOverviewPrompt("diff", [], "");
    assert.ok(prompt.includes("Markdown контекст не был добавлен"));
  });

  test("includes markdown context when non-empty string provided", () => {
    const prompt = buildDiffOverviewPrompt(
      "diff",
      [],
      "### docs/guide.md\nSome guide content here",
    );
    assert.ok(prompt.includes("docs/guide.md"));
    assert.ok(prompt.includes("Some guide content here"));
  });

  test("limits docs block to first 3 entries even if more supplied", () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeDoc({ libraryId: `lib${i}/lib${i}`, libraryName: `lib${i}`, content: `content${i}` }),
    );
    const prompt = buildDiffOverviewPrompt("diff", docs);
    assert.ok(prompt.includes("lib0"), "first doc should appear");
    assert.ok(prompt.includes("lib1"), "second doc should appear");
    assert.ok(prompt.includes("lib2"), "third doc should appear");
    assert.ok(!prompt.includes("lib3"), "fourth doc should not appear");
    assert.ok(!prompt.includes("lib4"), "fifth doc should not appear");
  });

  test("prompt is a non-empty string", () => {
    const prompt = buildDiffOverviewPrompt("some diff");
    assert.ok(typeof prompt === "string" && prompt.length > 0);
  });
});

// ---------------------------------------------------------------------------
// buildDiffCompactionPromptWithDocs
// ---------------------------------------------------------------------------

suite("Prompt Builders – buildDiffCompactionPromptWithDocs()", () => {
  test("contains the raw diff content", () => {
    const sentinel = "RAW_DIFF_SENTINEL_ABC";
    const prompt = buildDiffCompactionPromptWithDocs(sentinel);
    assert.ok(prompt.includes(sentinel));
  });

  test("contains the required per-file format rule", () => {
    const prompt = buildDiffCompactionPromptWithDocs("diff");
    assert.ok(prompt.includes("## <file path>"));
  });

  test("contains Risks and Questions section labels", () => {
    const prompt = buildDiffCompactionPromptWithDocs("diff");
    assert.ok(prompt.includes("Риски"));
    assert.ok(prompt.includes("Вопросы"));
  });

  test("shows docs fallback when no context provided", () => {
    const prompt = buildDiffCompactionPromptWithDocs("diff", []);
    assert.ok(
      prompt.includes(
        "Контекст документации Context7 не найден или недоступен",
      ),
    );
  });

  test("includes docs library name when context provided", () => {
    const doc = makeDoc({ libraryId: "axios/axios", libraryName: "axios" });
    const prompt = buildDiffCompactionPromptWithDocs("diff", [doc]);
    assert.ok(prompt.includes("axios"));
  });

  test("includes docs content when context provided", () => {
    const doc = makeDoc({ content: "HTTP_CLIENT_UNIQUE_CONTENT" });
    const prompt = buildDiffCompactionPromptWithDocs("diff", [doc]);
    assert.ok(prompt.includes("HTTP_CLIENT_UNIQUE_CONTENT"));
  });

  test("limits docs block to first 3 entries", () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeDoc({ libraryId: `lib${i}/lib${i}`, libraryName: `lib${i}` }),
    );
    const prompt = buildDiffCompactionPromptWithDocs("diff", docs);
    assert.ok(prompt.includes("lib2"), "third doc should appear");
    assert.ok(!prompt.includes("lib3"), "fourth doc should not appear");
  });

  test("prompt is a non-empty string", () => {
    const prompt = buildDiffCompactionPromptWithDocs("some diff");
    assert.ok(typeof prompt === "string" && prompt.length > 0);
  });
});
