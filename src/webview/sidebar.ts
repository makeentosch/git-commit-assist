import { createDiffRenderer } from "./diffRenderer.js";
import { createScreenManager } from "./screenManager.js";
import type { GitDiffSummary, WebviewMessage } from "./types.js";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

(function () {
  const vscode = acquireVsCodeApi();
  const keyStatusEl = document.getElementById("keyStatus") as HTMLElement;
  const homeScreenEl = document.getElementById("homeScreen") as HTMLElement;
  const diffScreenEl = document.getElementById("diffScreen") as HTMLElement;
  const overviewScreenEl = document.getElementById(
    "overviewScreen",
  ) as HTMLElement;
  const diffMetaEl = document.getElementById("diffMeta") as HTMLElement;
  const diffStatsEl = document.getElementById("diffStats") as HTMLElement;
  const diffFilesListEl = document.getElementById(
    "diffFilesList",
  ) as HTMLElement;
  const proceedButtonEl = document.getElementById(
    "proceedReview",
  ) as HTMLButtonElement;
  const includeMarkdownFilesEl = document.getElementById(
    "includeMarkdownFiles",
  ) as HTMLInputElement;
  const overviewDiffStatsEl = document.getElementById(
    "overviewDiffStats",
  ) as HTMLElement;
  const overviewDiffFilesListEl = document.getElementById(
    "overviewDiffFilesList",
  ) as HTMLElement;
  const overviewMarkdownEl = document.getElementById(
    "overviewMarkdown",
  ) as HTMLElement;
  const context7StatusEl = document.getElementById(
    "context7Status",
  ) as HTMLElement;
  const context7SourcesEl = document.getElementById(
    "context7Sources",
  ) as HTMLElement;

  const screens = createScreenManager(
    homeScreenEl,
    diffScreenEl,
    overviewScreenEl,
  );
  const renderer = createDiffRenderer({
    diffMetaEl,
    diffStatsEl,
    diffFilesListEl,
    overviewDiffStatsEl,
    overviewDiffFilesListEl,
  });

  let lastDiff: GitDiffSummary | null = null;

  (document.getElementById("startReview") as HTMLElement).addEventListener(
    "click",
    () => {
      vscode.postMessage({ command: "startReview" });
    },
  );

  (document.getElementById("cancelReview") as HTMLElement).addEventListener(
    "click",
    () => {
      screens.showHome();
    },
  );
  proceedButtonEl.addEventListener("click", () => {
    if (proceedButtonEl.classList.contains("is-loading")) {
      proceedButtonEl.disabled = true;
      proceedButtonEl.textContent = "Cancelling...";
      vscode.postMessage({ command: "cancelGeneration" });
      return;
    }
    if (lastDiff) {
      setProceedLoading(true);
      vscode.postMessage({
        command: "proceedReview",
        includeMarkdownFiles: includeMarkdownFilesEl.checked,
      });
    }
  });
  (document.getElementById("overviewGoBack") as HTMLElement).addEventListener(
    "click",
    () => {
      screens.showDiff();
    },
  );

  vscode.postMessage({ command: "webviewReady" });

  function setKeyStatus(configured: boolean): void {
    keyStatusEl.textContent = configured ? "Configured" : "Not set";
    keyStatusEl.className = configured
      ? "value status-ok"
      : "value status-missing";
  }

  function setProceedLoading(isLoading: boolean): void {
    proceedButtonEl.classList.toggle("is-loading", isLoading);
    if (isLoading) {
      proceedButtonEl.disabled = false;
      proceedButtonEl.textContent = "Cancel";
      proceedButtonEl.classList.add("secondary-button");
    } else {
      proceedButtonEl.disabled = false;
      proceedButtonEl.textContent = "Proceed";
      proceedButtonEl.classList.remove("secondary-button");
    }
  }

  function renderContext7Usage(message: WebviewMessage): void {
    context7StatusEl.textContent =
      message.context7Message ?? "Context7 status is not available.";
    while (context7SourcesEl.firstChild) {
      context7SourcesEl.removeChild(context7SourcesEl.firstChild);
    }

    const sources = message.context7Sources ?? [];
    if (sources.length === 0) {
      context7SourcesEl.classList.add("hidden");
      return;
    }

    context7SourcesEl.classList.remove("hidden");
    for (const source of sources) {
      const item = document.createElement("li");
      item.textContent = source;
      context7SourcesEl.appendChild(item);
    }
  }

  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as WebviewMessage;
    switch (message.command) {
      case "keyStatus":
        setKeyStatus(Boolean(message.configured));
        break;
      case "showDiff":
        if (message.diff) {
          lastDiff = message.diff;
          renderer.renderDiff(message.diff);
          screens.showDiff();
        }
        break;
      case "showReport":
        // TODO: render report in the sidebar
        break;
      case "overviewResult":
        setProceedLoading(false);
        if (message.overviewHtml) {
          overviewMarkdownEl.innerHTML = message.overviewHtml;
        } else if (message.overviewMarkdown) {
          overviewMarkdownEl.textContent = message.overviewMarkdown;
        }
        renderContext7Usage(message);
        if (lastDiff) {
          renderer.renderOverview(lastDiff);
        }
        screens.showOverview();
        break;
      case "overviewCancelled":
        setProceedLoading(false);
        break;
      case "overviewFailed":
        setProceedLoading(false);
        break;
    }
  });
})();
