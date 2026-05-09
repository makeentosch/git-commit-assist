import * as vscode from "vscode";
import { reviewDiffCommand } from "./commands/reviewDiff";
import { generateOverviewCommand } from "./commands/generateOverview";
import { SidebarProvider } from "./webview/sidebarProvider";
import { SecretStorageService } from "./services/secretStorage";

export function activate(context: vscode.ExtensionContext) {
  const secretService = new SecretStorageService(context.secrets);
  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    secretService,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      sidebarProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("git-commit-assist.reviewDiff", () =>
      reviewDiffCommand(sidebarProvider, secretService),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "git-commit-assist.generateOverview",
      (rawDiff: string, includeMarkdownFiles?: boolean, token?: vscode.CancellationToken) =>
        generateOverviewCommand(
          rawDiff,
          secretService,
          Boolean(includeMarkdownFiles),
          token,
        ),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "git-commit-assist.removeApiKey",
      async () => {
        await secretService.deleteApiKey();
        sidebarProvider.updateKeyStatus(false);
        vscode.window.showInformationMessage(
          "Git Commit Assist: API key removed.",
        );
      },
    ),
  );
}

export function deactivate() { }
