import * as vscode from "vscode";
import { stripCodicons, firstNonEmptyLine, isWorkingTreeDirtyError } from "./notify-pure";

export { stripCodicons, isWorkingTreeDirtyError };

export interface ErrorAction {
  label: string;
  run: () => Promise<void> | void;
}

// Surface a git error in two layers:
//   • A single-line summary toast with a "Details" button.
//   • Optional inline actions (Stash and retry, etc.) appear as additional buttons.
//   • "Details" opens a modal with the full multi-line message — VS Code toasts
//     silently collapse newlines, so we need the modal `detail` field.
export async function showGitError(
  scope: string,
  err: unknown,
  actions: ErrorAction[] = []
): Promise<void> {
  const raw = (err instanceof Error ? err.message : String(err)).trim();
  const summary = firstNonEmptyLine(raw);
  const cleanScope = stripCodicons(scope);
  const labels = ["Details", ...actions.map((a) => a.label)];
  const pick = await vscode.window.showErrorMessage(
    `${cleanScope}: ${summary}`,
    ...labels
  );
  if (!pick) return;
  if (pick === "Details") {
    await vscode.window.showErrorMessage(`${cleanScope} — full error`, {
      modal: true,
      detail: raw,
    });
    return;
  }
  const chosen = actions.find((a) => a.label === pick);
  if (chosen) await chosen.run();
}
