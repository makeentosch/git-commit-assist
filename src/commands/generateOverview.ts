import * as vscode from "vscode";
import { GeminiRepository } from "../ai/geminiRepository";
import { extractLibraryReferencesFromRawDiff } from "../analyzer/libraryReferences";
import {
  buildDiffCompactionPromptWithDocs,
  buildDiffOverviewPrompt,
} from "../analyzer/prompts/diffOverviewPrompt";
import { fetchDocumentationForReferences } from "../context7/client";
import { DocumentationContext } from "../models/types";
import { SecretStorageService } from "../services/secretStorage";

const MAX_COMPACT_DIFF_CHARS = 22000;
const MAX_CONTEXT7_ENTRIES = 10;
const MAX_CONTEXT7_CHARS_PER_ENTRY = 1200;
const MAX_MARKDOWN_SECTIONS = 3;
const MAX_MARKDOWN_CHARS_PER_SECTION = 900;
const MAX_MARKDOWN_CHARS_TOTAL_FOR_REVIEW = 2800;

export function normalizeCompactedDiff(compactedDiff: string, fallbackDiff: string): string {
  const trimmedCompactedDiff = compactedDiff.trim();
  if (!trimmedCompactedDiff) {
    return fallbackDiff;
  }

  return trimmedCompactedDiff.length > MAX_COMPACT_DIFF_CHARS
    ? `${trimmedCompactedDiff.slice(0, MAX_COMPACT_DIFF_CHARS)}\n\n[truncated]`
    : trimmedCompactedDiff;
}

function extractKeywords(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .filter((token) => token.length >= 4);
  return new Set(tokens);
}

function calculateRelevanceScore(content: string, keywords: Set<string>): number {
  if (keywords.size === 0) {
    return 0;
  }

  const contentLower = content.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (contentLower.includes(keyword)) {
      score += 1;
    }
  }

  return score;
}

export function compactDocumentationContext(
  docsContext: DocumentationContext[],
  compactedDiff: string,
): DocumentationContext[] {
  if (docsContext.length === 0) {
    return [];
  }

  const keywords = extractKeywords(compactedDiff);
  return docsContext
    .map((doc) => ({
      ...doc,
      score: calculateRelevanceScore(
        `${doc.libraryName}\n${doc.libraryId}\n${doc.content}`,
        keywords,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONTEXT7_ENTRIES)
    .map((doc) => ({
      libraryId: doc.libraryId,
      libraryName: doc.libraryName,
      content: doc.content.slice(0, MAX_CONTEXT7_CHARS_PER_ENTRY),
    }));
}

interface MarkdownSection {
  heading: string;
  content: string;
}

export function compactMarkdownContext(
  markdownContext: string,
  compactedDiff: string,
): string {
  const trimmedContext = markdownContext.trim();
  if (!trimmedContext) {
    return "";
  }

  const chunks = trimmedContext.split("\n### ");
  const sections: MarkdownSection[] = chunks
    .map((chunk, index) => {
      const normalizedChunk = index === 0 ? chunk : `### ${chunk}`;
      const lines = normalizedChunk.split("\n");
      const headingLine = lines[0]?.startsWith("### ")
        ? lines[0]
        : "### docs/unknown.md";
      const content = lines.slice(1).join("\n").trim();

      return {
        heading: headingLine,
        content,
      };
    })
    .filter((section) => section.content.length > 0);

  const keywords = extractKeywords(compactedDiff);
  const compactedSections = sections
    .map((section) => ({
      ...section,
      score: calculateRelevanceScore(
        `${section.heading}\n${section.content}`,
        keywords,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MARKDOWN_SECTIONS);

  let totalChars = 0;
  const resultSections: string[] = [];
  for (const section of compactedSections) {
    if (totalChars >= MAX_MARKDOWN_CHARS_TOTAL_FOR_REVIEW) {
      break;
    }

    const remainingChars = MAX_MARKDOWN_CHARS_TOTAL_FOR_REVIEW - totalChars;
    const chunk = section.content.slice(
      0,
      Math.min(MAX_MARKDOWN_CHARS_PER_SECTION, remainingChars),
    );
    if (!chunk.trim()) {
      continue;
    }

    resultSections.push([section.heading, chunk].join("\n"));
    totalChars += chunk.length;
  }

  return resultSections.join("\n\n");
}

export async function generateOverviewCommand(
  rawDiff: string,
  secretService: SecretStorageService,
  includeMarkdownFiles = false,
): Promise<
  | {
    markdown: string;
    html: string;
    context7Used: boolean;
    context7Sources: string[];
    context7Message: string;
  }
  | undefined
> {
  if (!rawDiff.trim()) {
    vscode.window.showErrorMessage(
      "Git Commit Assist: empty diff, cannot generate AI overview.",
    );
    return undefined;
  }

  const apiKey = await secretService.requireApiKey();
  if (!apiKey) {
    vscode.window.showErrorMessage(
      "Git Commit Assist: API key is required to generate AI overview.",
    );
    return undefined;
  }

  const markdownContext = includeMarkdownFiles
    ? await loadMarkdownContext()
    : "";

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating AI overview...",
      cancellable: false,
    },
    async () => {
      try {
        const { marked } = await import("marked");
        const geminiRepository = new GeminiRepository(apiKey);
        const libraryReferences = extractLibraryReferencesFromRawDiff(rawDiff);
        let docsContext: DocumentationContext[] = [];
        let context7Message = "Context7 не использовался.";
        try {
          docsContext = await fetchDocumentationForReferences(libraryReferences, {
            workspaceRoot:
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          });
          context7Message =
            docsContext.length > 0
              ? `Context7: получено ${docsContext.length} набора документации.`
              : "Context7: релевантная документация не найдена.";
        } catch (contextError) {
          const contextMessage =
            contextError instanceof Error
              ? contextError.message
              : String(contextError);
          console.warn(
            `[Git Commit Assist] Context7 unavailable: ${contextMessage}`,
          );
          context7Message = `Context7 недоступен: ${contextMessage}`;
        }
        const compactedDiffPrompt = buildDiffCompactionPromptWithDocs(
          rawDiff,
          docsContext,
        );
        const compactedDiff = normalizeCompactedDiff(
          await geminiRepository.sendMessage(compactedDiffPrompt),
          rawDiff,
        );
        const compactedDocsContext = compactDocumentationContext(
          docsContext,
          compactedDiff,
        );
        const compactedMarkdownContext = compactMarkdownContext(
          markdownContext,
          compactedDiff,
        );

        const prompt = buildDiffOverviewPrompt(
          compactedDiff,
          compactedDocsContext,
          compactedMarkdownContext,
        );
        const overview = await geminiRepository.sendMessage(prompt);
        const overviewHtml = marked.parse(overview, { async: false }) as string;

        // Output to extension host console for the current milestone.
        console.log("[Git Commit Assist] AI Overview Result:");
        console.log(overview);
        return {
          markdown: overview,
          html: overviewHtml,
          context7Used: compactedDocsContext.length > 0,
          context7Sources: compactedDocsContext.map(
            (doc) => `${doc.libraryName} (${doc.libraryId})`,
          ),
          context7Message,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`AI overview failed: ${message}`);
        return undefined;
      }
    },
  );
}

const MAX_MARKDOWN_CHARS_PER_FILE = 3500;
const MAX_MARKDOWN_CHARS_TOTAL = 12000;

async function loadMarkdownContext(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return "";
  }

  const markdownUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, "docs/**/*.md"),
  );
  if (markdownUris.length === 0) {
    return "";
  }

  const snippets: string[] = [];
  const decoder = new TextDecoder("utf-8");
  let totalChars = 0;
  for (const markdownUri of markdownUris) {
    try {
      const content = decoder.decode(
        await vscode.workspace.fs.readFile(markdownUri),
      );
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        continue;
      }

      if (totalChars >= MAX_MARKDOWN_CHARS_TOTAL) {
        break;
      }

      const remainingChars = MAX_MARKDOWN_CHARS_TOTAL - totalChars;
      const fileChunk = trimmedContent.slice(
        0,
        Math.min(MAX_MARKDOWN_CHARS_PER_FILE, remainingChars),
      );
      const relativePath = vscode.workspace.asRelativePath(markdownUri, false);

      snippets.push([`### ${relativePath}`, "```markdown", fileChunk, "```"].join("\n"));
      totalChars += fileChunk.length;
    } catch {
      // File is optional: skip missing or unreadable markdown files.
    }
  }

  return snippets.join("\n\n");
}
