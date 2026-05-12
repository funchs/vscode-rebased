import * as vscode from "vscode";
import { RepoManager } from "./core/repo";
import { RebaseEditorProvider } from "./m0-rebase/editor-provider";
import { LogViewProvider } from "./m1-log/view-provider";
import { CommitViewProvider } from "./m2-commit/view-provider";
import { StashTreeProvider } from "./m3-stash/tree-provider";
import { BranchTreeProvider } from "./m3-stash/branch-tree";
import { registerStashCommands } from "./m3-stash/commands";
import { registerBranchCommands } from "./m3-stash/branch-commands";
import { BranchStatusBar } from "./m4-settings/status-bar";

export function activate(ctx: vscode.ExtensionContext): void {
  const repos = new RepoManager();
  ctx.subscriptions.push(repos);

  ctx.subscriptions.push(new BranchStatusBar(repos));

  // External git operations (terminal commands, other tools) don't touch our
  // FileSystemWatcher reliably. Refresh whenever the window regains focus so
  // the user sees fresh state on tab return.
  ctx.subscriptions.push(
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) repos.fire();
    })
  );

  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      RebaseEditorProvider.viewType,
      new RebaseEditorProvider(ctx),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  const logView = new LogViewProvider(ctx, repos);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LogViewProvider.viewType, logView)
  );
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.log.refresh", () => logView.refresh())
  );

  const commitView = new CommitViewProvider(ctx, repos);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, commitView)
  );
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.commit.refresh", () => commitView.refresh())
  );

  const stashProvider = new StashTreeProvider(repos);
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider("rebased.stash", stashProvider)
  );

  const branchProvider = new BranchTreeProvider(repos);
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider("rebased.branches", branchProvider)
  );

  registerStashCommands(ctx, repos);
  registerBranchCommands(ctx, repos);
}

export function deactivate(): void {
  /* nothing */
}
