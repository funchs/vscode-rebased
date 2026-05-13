import * as vscode from "vscode";
import { commit as gitCommit } from "../core/git";
import { COMMIT_TYPES, formatCC, validateCC } from "../core/conventional-commit";
import { mineScopes } from "../core/scope-miner";
import type { RepoManager } from "../core/repo";
import { showGitError } from "../core/notify";

interface State {
  type?: string;
  scope?: string;
  subject?: string;
  body?: string;
  breaking?: boolean;
  breakingDescription?: string;
}

function typeDescription(t: string): string {
  switch (t) {
    case "feat": return vscode.l10n.t("A new feature");
    case "fix": return vscode.l10n.t("A bug fix");
    case "docs": return vscode.l10n.t("Documentation only");
    case "style": return vscode.l10n.t("Whitespace/formatting (no logic)");
    case "refactor": return vscode.l10n.t("Code change that neither fixes nor adds features");
    case "perf": return vscode.l10n.t("Performance improvement");
    case "test": return vscode.l10n.t("Tests only");
    case "build": return vscode.l10n.t("Build system or dependencies");
    case "ci": return vscode.l10n.t("CI configuration");
    case "chore": return vscode.l10n.t("Other changes — maintenance, tooling");
    case "revert": return vscode.l10n.t("Reverts a previous commit");
    default: return "";
  }
}

export async function runCommitWizard(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;

  const state: State = {};

  // 1. Type
  const typePick = await vscode.window.showQuickPick(
    COMMIT_TYPES.map((t) => ({ label: t, description: typeDescription(t) })),
    { placeHolder: vscode.l10n.t("Commit type") }
  );
  if (!typePick) return;
  state.type = typePick.label;

  // 2. Scope (optional). Offer mined scopes plus "(none)" and "(custom)".
  let scopes: { scope: string; count: number; lastUsedDays: number }[] = [];
  try {
    scopes = await mineScopes(root, 500);
  } catch {
    // miner can fail on empty repo — fine, just skip suggestions
  }
  const NONE = { label: "$(circle-slash) (no scope)", value: "" };
  const CUSTOM = { label: "$(edit) Custom scope…", value: "__custom__" };
  const scopeItems = [
    NONE,
    CUSTOM,
    ...(scopes.length ? [{ label: vscode.l10n.t("Recent / frequent"), kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem] : []),
    ...scopes.map((s) => ({
      label: s.scope,
      description: `${s.count}× · last ${s.lastUsedDays}d ago`,
      value: s.scope,
    })),
  ];
  const scopePick = await vscode.window.showQuickPick(scopeItems as Array<vscode.QuickPickItem & { value?: string }>, {
    placeHolder: vscode.l10n.t("Scope (optional)"),
    matchOnDescription: true,
  });
  if (scopePick === undefined) return;
  if (scopePick.value === "__custom__") {
    const custom = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Custom scope") });
    if (custom === undefined) return;
    state.scope = custom.trim() || undefined;
  } else if (scopePick.value) {
    state.scope = scopePick.value;
  }

  // 3. Subject — show live remaining-chars feedback.
  const subjectInput = vscode.window.createInputBox();
  subjectInput.title = vscode.l10n.t("Subject");
  subjectInput.placeholder = vscode.l10n.t("Imperative, lowercase, no period");
  const prefix = `${state.type}${state.scope ? `(${state.scope})` : ""}: `;
  subjectInput.prompt = vscode.l10n.t("Will be prefixed: \"{0}\"  ·  recommended ≤ {1} chars", prefix, String(72 - prefix.length));
  const subject = await new Promise<string | undefined>((resolve) => {
    subjectInput.onDidChangeValue((v) => {
      const total = prefix.length + v.length;
      subjectInput.validationMessage = total > 72 ? {
        message: vscode.l10n.t("Header is {0} chars — over the 72 recommendation.", String(total)),
        severity: vscode.InputBoxValidationSeverity.Warning,
      } : undefined;
    });
    subjectInput.onDidAccept(() => {
      resolve(subjectInput.value.trim() || undefined);
      subjectInput.hide();
    });
    subjectInput.onDidHide(() => resolve(undefined));
    subjectInput.show();
  });
  if (!subject) return;
  state.subject = subject;

  // 4. Body (optional).
  const body = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Body (optional, supports multi-line via \\n)"),
    placeHolder: vscode.l10n.t("What and why, not how"),
  });
  if (body === undefined) return;
  state.body = body.replace(/\\n/g, "\n").trim() || undefined;

  // 5. Breaking change?
  const breakingPick = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t("No"), value: false },
      { label: vscode.l10n.t("Yes — append ! to header and add BREAKING-CHANGE footer"), value: true },
    ],
    { placeHolder: vscode.l10n.t("Breaking change?") }
  );
  if (!breakingPick) return;
  state.breaking = breakingPick.value;
  if (state.breaking) {
    const desc = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Describe the breaking change") });
    if (desc === undefined) return;
    state.breakingDescription = desc.trim() || undefined;
  }

  // 6. Preview + commit
  const message = formatCC({
    type: state.type,
    scope: state.scope,
    breaking: state.breaking,
    subject: state.subject,
    body: state.body,
    breakingDescription: state.breakingDescription,
  });
  const issues = validateCC(message);
  const blockingIssue = issues.find((i) => i.severity === "error");
  if (blockingIssue) {
    vscode.window.showErrorMessage(vscode.l10n.t("Commit message invalid: {0}", blockingIssue.message));
    return;
  }
  const warnings = issues.filter((i) => i.severity === "warning");

  const lines = message.split("\n");
  const preview = lines.slice(0, 5).map((l) => `   ${l}`).join("\n") + (lines.length > 5 ? "\n   …" : "");
  const warningHint = warnings.length ? "\n\n⚠ " + vscode.l10n.t("{0} warning(s): {1}", String(warnings.length), warnings.map((w) => w.message).join(" · ")) : "";

  const commitLabel = vscode.l10n.t("Commit");
  const editLabel = vscode.l10n.t("Edit & continue");
  const action = await vscode.window.showInformationMessage(
    vscode.l10n.t("Commit with this message?") + `\n\n${preview}${warningHint}`,
    { modal: true },
    commitLabel,
    editLabel
  );
  if (action === commitLabel) {
    try {
      await gitCommit(root, message);
      repos.fire();
      vscode.window.setStatusBarMessage("$(check) " + vscode.l10n.t("Committed."), 3000);
    } catch (e: unknown) {
      await showGitError("Commit", e);
    }
  } else if (action === editLabel) {
    // Stash the structured message into the clipboard so the user can paste.
    await vscode.env.clipboard.writeText(message);
    vscode.window.showInformationMessage(vscode.l10n.t("Commit message copied to clipboard."));
  }
}
