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
import { InlineBlame } from "./m4-settings/inline-blame";
import { HunkPanel } from "./m2-commit/hunk-panel";
import { ReflogPanel } from "./m3-stash/reflog-panel";
import { ConflictWatcher, showConflictResolution } from "./m3-stash/conflict-panel";
import { CommitDetailsPanel } from "./m1-log/details-panel";
import { showBranchesPicker } from "./m3-stash/branches-picker";
import { showFileHistory } from "./m1-log/file-history";
import { compareBranches } from "./m1-log/compare-branches";
import { showTagsPicker } from "./m3-stash/tags-picker";
import { BlameGutter } from "./m4-settings/blame-gutter";
import { showPushDialog, showPullDialog } from "./m3-stash/push-pull";
import { showCommitSearch } from "./m1-log/commit-search";
import { showRemotesPicker } from "./m3-stash/remotes-picker";
import {
  ChangelistManager,
  ChangelistTreeProvider,
  registerChangelistCommands,
} from "./m2-commit/changelists";
import { LocalHistory } from "./m4-settings/local-history";
import { SubmoduleTreeProvider, registerSubmoduleCommands } from "./m3-stash/submodules";
import { runCommitWizard } from "./m2-commit/commit-wizard";
import { updateProject } from "./m3-stash/update-project";

export function activate(ctx: vscode.ExtensionContext): void {
  const repos = new RepoManager();
  ctx.subscriptions.push(repos);

  ctx.subscriptions.push(new BranchStatusBar(repos));
  ctx.subscriptions.push(new ConflictWatcher(repos));

  if (vscode.workspace.getConfiguration("rebased").get<boolean>("blame.enabled", true)) {
    ctx.subscriptions.push(new InlineBlame(repos));
  }

  const blameGutter = new BlameGutter(repos);
  ctx.subscriptions.push(blameGutter);

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

  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.hunks.open", (path: string) => {
      HunkPanel.show(ctx, repos, path);
    }),
    vscode.commands.registerCommand("rebased.reflog.open", () => {
      ReflogPanel.show(ctx, repos);
    }),
    vscode.commands.registerCommand("rebased.conflict.show", () => showConflictResolution(repos)),
    vscode.commands.registerCommand("rebased.commit.show", (hash: string) =>
      CommitDetailsPanel.show(ctx, repos, hash)
    ),
    vscode.commands.registerCommand("rebased.branches.pick", () => showBranchesPicker(repos)),
    vscode.commands.registerCommand("rebased.file.history", (uri?: vscode.Uri) =>
      showFileHistory(repos, uri)
    ),
    vscode.commands.registerCommand("rebased.branch.compare", (name?: string) =>
      compareBranches(repos, name)
    ),
    vscode.commands.registerCommand("rebased.tags.pick", () => showTagsPicker(repos)),
    vscode.commands.registerCommand("rebased.blame.toggleGutter", () => blameGutter.toggle()),
    vscode.commands.registerCommand("rebased.push", () => showPushDialog(repos)),
    vscode.commands.registerCommand("rebased.pull", () => showPullDialog(repos)),
    vscode.commands.registerCommand("rebased.commit.search", () => showCommitSearch(repos)),
    vscode.commands.registerCommand("rebased.remotes.pick", () => showRemotesPicker(repos))
  );

  // Changelists
  const changelistMgr = new ChangelistManager(ctx, repos);
  const changelistTree = new ChangelistTreeProvider(changelistMgr, repos);
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider("rebased.changelists", changelistTree)
  );
  registerChangelistCommands(ctx, changelistMgr, changelistTree);

  // Local history
  const localHistory = new LocalHistory(ctx, repos);
  ctx.subscriptions.push(localHistory);
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.localHistory.show", (uri?: vscode.Uri) =>
      localHistory.showHistory(uri)
    )
  );

  // Submodules
  const submoduleTree = new SubmoduleTreeProvider(repos);
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider("rebased.submodules", submoduleTree)
  );
  registerSubmoduleCommands(ctx, repos);

  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.commit.wizard", () => runCommitWizard(repos)),
    vscode.commands.registerCommand("rebased.updateProject", () => updateProject(repos))
  );
}

export function deactivate(): void {
  /* nothing */
}
