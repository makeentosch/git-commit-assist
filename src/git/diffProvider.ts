import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import { DiffFile, DiffHunk, StagedDiff } from "../models/types";

const execFileAsync = promisify(execFile);

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    return "text";
  }

  return ext.slice(1);
}

export function parseDiff(rawDiff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = rawDiff.split("\n");
  let currentFile: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;

  const pushCurrentHunk = (): void => {
    if (!currentFile || !currentHunk) {
      return;
    }

    currentFile.hunks.push(currentHunk);
    currentHunk = undefined;
  };

  const pushCurrentFile = (): void => {
    if (!currentFile) {
      return;
    }

    pushCurrentHunk();
    files.push(currentFile);
    currentFile = undefined;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      pushCurrentFile();
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const filePath = match?.[2] ?? "unknown";
      currentFile = {
        filePath,
        language: detectLanguage(filePath),
        hunks: [],
      };
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith("@@")) {
      pushCurrentHunk();
      currentHunk = {
        header: line,
        addedLines: [],
        removedLines: [],
        context: [],
      };
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.addedLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.removedLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith(" ")) {
      currentHunk.context.push(line.slice(1));
    }
  }

  pushCurrentFile();
  return files;
}

export async function getStagedDiff(
  workspaceRoot: string,
): Promise<StagedDiff> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--cached", "--no-color", "--unified=3"],
      { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 },
    );

    const raw = stdout ?? "";
    return {
      raw,
      files: parseDiff(raw),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read staged diff: ${message}`);
  }
}
