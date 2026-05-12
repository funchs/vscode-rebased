import * as vscode from "vscode";
import { commit as gitCommit } from "../core/git";
import { COMMIT_TYPES, formatCC, validateCC } from "../core/conventional-commit";
import { mineScopes } from "../core/scope-miner";
import type { RepoManager } from "../core/repo";

interface State {
  type?: string;
  scope?: string;
  subject?: string;
  body?: string;
  breaking?: boolean;
  breakingDescription?: string;
}

const TYPE_DESCRIPTIONS: Record<string, string> = {
  feat: "A new feature",
  fix: "A bug fix",
  docs: "Documentation only",
  style: "Whitespace/formatting (no logic)",
  refactor: "Code change that neither fixes nor adds features",
  perf: "Performance improvement",
  test: "Tests only",
  build: "Build system or dependencies",
  ci: "CI configuration",
  chore: "Other changes — maintenance, tooling",
  revert: "Reverts a previous commit",
};

export async function runCommitWizard(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;

  const state: State = {};

  // 1. Type
  const typePick = await vscode.window.showQuickPick(
    COMMIT_TYPES.map((t) => ({ label: t, description: TYPE_DESCRIPTIONS[t] ?? "" })),
    { placeHolder: "Commit type" }
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
    ...(scopes.length ? [{ label: "Recent / frequent", kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem] : []),
    ...scopes.map((s) => ({
      label: s.scope,
      description: `${s.count}× · last ${s.lastUsedDays}d ago`,
      value: s.scope,
    })),
  ];
  const scopePick = await vscode.window.showQuickPick(scopeItems as Array<vscode.QuickPickItem & { value?: string }>, {
    placeHolder: "Scope (optional)",
    matchOnDescription: true,
  });
  if (scopePick === undefined) return;
  if (scopePick.value === "__custom__") {
    const custom = await vscode.window.showInputBox({ prompt: "Custom scope" });
    if (custom === undefined) return;
    state.scope = custom.trim() || undefined;
  } else if (scopePick.value) {
    state.scope = scopePick.value;
  }

  // 3. Subject — show live remaining-chars feedback.
  const subjectInput = vscode.window.createInputBox();
  subjectInput.title = "Subject";
  subjectInput.placeholder = "Imperative, lowercase, no period";
  const prefix = `${state.type}${state.scope ? `(${state.scope})` : ""}: `;
  subjectInput.prompt = `Will be prefixed: "${prefix}"  ·  recommended ≤ ${72 - prefix.length} chars`;
  const subject = await new Promise<string | undefined>((resolve) => {
    subjectInput.onDidChangeValue((v) => {
      const total = prefix.length + v.length;
      subjectInput.validationMessage = total > 72 ? {
        message: `Header is ${total} chars — over the 72 recommendation.`,
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
    prompt: "Body (optional, supports multi-line via \\n)",
    placeHolder: "What and why, not how",
  });
  if (body === undefined) return;
  state.body = body.replace(/\\n/g, "\n").trim() || undefined;

  // 5. Breaking change?
  const breakingPick = await vscode.window.showQuickPick(
    [
      { label: "No", value: false },
      { label: "Yes — append ! to header and add BREAKING-CHANGE footer", value: true },
    ],
    { placeHolder: "Breaking change?" }
  );
  if (!breakingPick) return;
  state.breaking = breakingPick.value;
  if (state.breaking) {
    const desc = await vscode.window.showInputBox({ prompt: "Describe the breaking change" });
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
    vscode.window.showErrorMessage(`Commit message invalid: ${blockingIssue.message}`);
    return;
  }
  const warnings = issues.filter((i) => i.severity === "warning");

  const lines = message.split("\n");
  const preview = lines.slice(0, 5).map((l) => `   ${l}`).join("\n") + (lines.length > 5 ? "\n   …" : "");
  const warningHint = warnings.length ? `\n\n⚠ ${warnings.length} warning(s): ${warnings.map((w) => w.message).join(" · ")}` : "";

  const action = await vscode.window.showInformationMessage(
    `Commit with this message?\n\n${preview}${warningHint}`,
    { modal: true },
    "Commit",
    "Edit & continue"
  );
  if (action === "Commit") {
    try {
      await gitCommit(root, message);
      repos.fire();
      vscode.window.setStatusBarMessage("$(check) Committed.", 3000);
    } catch (e: unknown) {
      vscode.window.showErrorMessage(`Commit failed: ${(e as Error).message}`);
    }
  } else if (action === "Edit & continue") {
    // Stash the structured message into the clipboard so the user can paste.
    await vscode.env.clipboard.writeText(message);
    vscode.window.showInformationMessage("Commit message copied to clipboard.");
  }
}
