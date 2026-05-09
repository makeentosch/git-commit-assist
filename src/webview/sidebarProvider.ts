import * as vscode from "vscode";
import { GitDiffSummary, ReviewReport, StagedDiff } from "../models/types";
import { SecretStorageService } from "../services/secretStorage";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "git-commit-assist.sidebar";

  private view?: vscode.WebviewView;
  private lastRawDiff = "";
  private _generationCts: vscode.CancellationTokenSource | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secretService: SecretStorageService,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "out", "webview"),
      ],
    };

    webviewView.webview.html = "<html><body>Loading Git Commit Assist...</body></html>";
    void this.setWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.command === "startReview") {
        vscode.commands.executeCommand("git-commit-assist.reviewDiff");
        return;
      }

      if (message.command === "proceedReview") {
        const includeMarkdownFiles = Boolean(message.includeMarkdownFiles);
        void this.handleProceedReview(includeMarkdownFiles);
        return;
      }

      if (message.command === "cancelGeneration") {
        this._generationCts?.cancel();
        return;
      }

      if (message.command === "webviewReady") {
        void this.refreshKeyStatus();
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  public showReport(report: ReviewReport): void {
    if (this.view) {
      this.view.webview.postMessage({ command: "showReport", report });
      this.view.show?.(true);
    }
  }

  public showDiff(diff: StagedDiff): void {
    this.lastRawDiff = diff.raw;

    const summary: GitDiffSummary = {
      filesCount: diff.files.length,
      addedLines: diff.files.reduce(
        (acc, file) =>
          acc +
          file.hunks.reduce((hAcc, hunk) => hAcc + hunk.addedLines.length, 0),
        0,
      ),
      removedLines: diff.files.reduce(
        (acc, file) =>
          acc +
          file.hunks.reduce((hAcc, hunk) => hAcc + hunk.removedLines.length, 0),
        0,
      ),
      files: diff.files,
    };

    if (this.view) {
      this.view.webview.postMessage({ command: "showDiff", diff: summary });
      this.view.show?.(true);
    }
  }

  public updateKeyStatus(configured: boolean): void {
    if (this.view) {
      this.view.webview.postMessage({ command: "keyStatus", configured });
    }
  }

  private async handleProceedReview(
    includeMarkdownFiles: boolean,
  ): Promise<void> {
    if (!this.view) {
      return;
    }

    if (!this.lastRawDiff.trim()) {
      this.view.webview.postMessage({ command: "overviewFailed" });
      vscode.window.showErrorMessage(
        "Git Commit Assist: no staged diff available for overview.",
      );
      return;
    }

    this._generationCts?.cancel();
    this._generationCts?.dispose();
    const cts = new vscode.CancellationTokenSource();
    this._generationCts = cts;

    try {
      const overview = await vscode.commands.executeCommand<
        | {
            markdown: string;
            html: string;
            context7Used: boolean;
            context7Sources: string[];
            context7Message: string;
          }
        | undefined
      >(
        "git-commit-assist.generateOverview",
        this.lastRawDiff,
        includeMarkdownFiles,
        cts.token,
      );

      if (!this.view) {
        return;
      }

      if (overview) {
        this.view.webview.postMessage({
          command: "overviewResult",
          overviewMarkdown: overview.markdown,
          overviewHtml: overview.html,
          context7Used: overview.context7Used,
          context7Sources: overview.context7Sources,
          context7Message: overview.context7Message,
        });
        return;
      }

      this.view.webview.postMessage({ command: "overviewFailed" });
    } catch (e) {
      if (!this.view) {
        return;
      }
      if (e instanceof vscode.CancellationError) {
        this.view.webview.postMessage({ command: "overviewCancelled" });
      } else {
        this.view.webview.postMessage({ command: "overviewFailed" });
      }
    } finally {
      cts.dispose();
      if (this._generationCts === cts) {
        this._generationCts = undefined;
      }
    }
  }

  private async refreshKeyStatus(): Promise<void> {
    const key = await this.secretService.getApiKey();
    this.updateKeyStatus(!!key);
  }

  private async setWebviewHtml(webview: vscode.Webview): Promise<void> {
    try {
      webview.html = await this.getHtml(webview);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      webview.html = `<html><body>Failed to load UI: ${message}</body></html>`;
      vscode.window.showErrorMessage(
        `Git Commit Assist: failed to load sidebar UI (${message}).`,
      );
    }
  }

  private async getHtml(webview: vscode.Webview): Promise<string> {
    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, "out", "webview");
    const screenRoot = vscode.Uri.joinPath(webviewRoot, "screens");

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "sidebar.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "sidebar.js"),
    );

    const htmlTemplate = await this.readTextFile(
      vscode.Uri.joinPath(webviewRoot, "sidebar.html"),
    );
    const homeScreen = await this.readTextFile(
      vscode.Uri.joinPath(screenRoot, "home.html"),
    );
    const diffScreen = await this.readTextFile(
      vscode.Uri.joinPath(screenRoot, "diff.html"),
    );
    const overviewScreen = await this.readTextFile(
      vscode.Uri.joinPath(screenRoot, "overview.html"),
    );

    let html = htmlTemplate;
    html = html.replace(/\{\{cssUri\}\}/g, cssUri.toString());
    html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());
    html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
    html = html.replace(/\{\{homeScreen\}\}/g, homeScreen);
    html = html.replace(/\{\{diffScreen\}\}/g, diffScreen);
    html = html.replace(/\{\{overviewScreen\}\}/g, overviewScreen);

    return html;
  }

  private async readTextFile(uri: vscode.Uri): Promise<string> {
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString("utf-8");
  }
}
